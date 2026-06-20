/**
 * Canonical SPLASH (SPectraL hASH) implementation.
 *
 * Offline, deterministic, browser-compatible port of the reference algorithm
 * (`berlinguyinca/spectra-hash`, Wohlgemuth et al., Nat. Biotechnol. 2016).
 * Hashing uses the Web Crypto API (`globalThis.crypto.subtle`) so it runs in
 * both browsers and Node >= 18 — never `node:crypto`, which breaks the browser
 * build (the core purpose of this package).
 */

/** A single peak: m/z and (absolute) intensity. */
export interface SplashPeak {
  mz: number;
  intensity: number;
}

const EPS = 1e-7;
const INTENSITY_MAP = '0123456789abcdefghijklmnopqrstuvwxyz'; // 36 chars
const MZ_FACTOR = 1e6;

// Intensities are normalized relative to the base peak (= RELATIVE_SCALE)
// before any block is computed. Blocks 1 & 2 are scale-invariant (they
// re-normalize by their own bin maximum), but block 3 hashes the truncated
// intensity directly, so it is NOT scale-invariant — it must see the relative
// intensity. The canonical reference (and the Fiehn SPLASH service) scale to
// 100. Verified empirically: this reproduces the declared PK$SPLASH of all 114
// real MassBank sample records (== the live API) and both reference vectors,
// whereas using raw absolute intensity passes only the reference vectors (whose
// max intensity happens to already be 100, masking the difference).
const RELATIVE_SCALE = 100;

// Block 1 (prefilter) parameters
const PREFILTER_BASE = 3;
const PREFILTER_BIN_SIZE = 5;
const PREFILTER_TOP_N = 10;
const PREFILTER_BASE_PEAK_FRACTION = 0.1;

// Block 2 (similarity histogram) parameters
const SIMILARITY_BASE = 10;
const SIMILARITY_BIN_SIZE = 100;

const HISTOGRAM_BINS = 10;

/**
 * Largest intensity in a peak list. A manual loop (not `Math.max(...peaks)`)
 * because spreading a large spectrum overflows the call stack.
 * @param peaks - the peaks
 * @returns the maximum intensity (-Infinity for an empty list)
 */
function maxIntensity(peaks: SplashPeak[]): number {
  let max = -Infinity;
  for (const p of peaks) {
    if (p.intensity > max) max = p.intensity;
  }
  return max;
}

/**
 * Translate an integer expressed as a `initialBase` digit string into a
 * `targetBase` string, zero-padded to `fillLength`. BigInt-safe.
 * @param characters - digit string in `initialBase`
 * @param initialBase - base the input string is written in
 * @param targetBase - base to convert to
 * @param fillLength - minimum output length (left-padded with '0')
 * @returns the value rendered in `targetBase`, left-padded to `fillLength`
 */
function translateBase(
  characters: string,
  initialBase: number,
  targetBase: number,
  fillLength: number,
): string {
  const inBase = BigInt(initialBase);
  let value = 0n;
  for (const ch of characters) {
    value = value * inBase + BigInt(Number.parseInt(ch, initialBase));
  }

  const outBase = BigInt(targetBase);
  let result = '';
  if (value === 0n) {
    result = '0';
  } else {
    while (value > 0n) {
      result = INTENSITY_MAP.charAt(Number(value % outBase)) + result;
      value /= outBase;
    }
  }
  return result.padStart(fillLength, '0');
}

/**
 * Build a wrapped, normalized intensity histogram and render it as a string of
 * `INTENSITY_MAP` characters (one per bin).
 * @param peaks - peaks to histogram
 * @param binSize - m/z width of each bin
 * @param base - normalization base (number of intensity levels)
 * @returns one character per bin
 */
function calculateHistogram(
  peaks: SplashPeak[],
  binSize: number,
  base: number,
): string {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);

  for (const { mz, intensity } of peaks) {
    const index = Math.trunc(mz / binSize) % HISTOGRAM_BINS;
    bins[index] = (bins[index] ?? 0) + intensity;
  }

  const max = Math.max(...bins);
  // The reference divides by the max bin; an empty or all-zero spectrum makes
  // this a division by zero. Refuse to emit a non-canonical hash.
  if (max === 0) {
    throw new RangeError(
      'Cannot calculate SPLASH for an empty or all-zero-intensity spectrum.',
    );
  }

  return bins
    .map((x) => INTENSITY_MAP.charAt(Math.trunc(EPS + (base - 1) * (x / max))))
    .join('');
}

/**
 * Block 1 — prefiltered histogram of the top peaks, base-3, rendered as 4
 * base-36 characters.
 * @param peaks - all peaks
 * @returns the 4-character prefilter block
 */
function calculatePrefilterBlock(peaks: SplashPeak[]): string {
  const basePeak = maxIntensity(peaks);

  const filtered = peaks
    .filter((p) => p.intensity + EPS >= PREFILTER_BASE_PEAK_FRACTION * basePeak)
    .toSorted((a, b) => b.intensity - a.intensity || a.mz - b.mz)
    .slice(0, PREFILTER_TOP_N);

  const histogram = calculateHistogram(
    filtered,
    PREFILTER_BIN_SIZE,
    PREFILTER_BASE,
  );
  return translateBase(histogram, PREFILTER_BASE, 36, 4);
}

/**
 * Block 2 — similarity histogram over all peaks, base-10, 10 characters.
 * @param peaks - all peaks
 * @returns the 10-character similarity block
 */
function calculateSimilarityBlock(peaks: SplashPeak[]): string {
  return calculateHistogram(peaks, SIMILARITY_BIN_SIZE, SIMILARITY_BASE);
}

/**
 * SHA-256 of `input` (UTF-8) as a lowercase hex string, via Web Crypto.
 * @param input - text to hash
 * @returns the lowercase hex digest
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Block 3 — SHA-256 over the truncated, sorted peak list; first 20 hex chars.
 * @param peaks - all peaks
 * @returns the 20-character hash block
 */
async function calculateHashBlock(peaks: SplashPeak[]): Promise<string> {
  const formatted = peaks
    .map((p) => ({
      mz: Math.trunc((p.mz + EPS) * MZ_FACTOR),
      intensity: Math.trunc(p.intensity + EPS),
    }))
    .toSorted((a, b) => a.mz - b.mz || b.intensity - a.intensity)
    .map((p) => `${p.mz}:${p.intensity}`)
    .join(' ');

  const hex = await sha256Hex(formatted);
  return hex.slice(0, 20);
}

/**
 * Calculate the canonical SPLASH for a peak list.
 *
 * Output: `splash10-<block1:4>-<block2:10>-<block3:20>` where `splash10`
 * encodes MS spectrum type (`1`) and version (`0`).
 * @param peaks - the spectrum's peaks (absolute intensities)
 * @returns the SPLASH string
 * @throws {RangeError} if the spectrum is empty, all intensities are zero, or
 *   any m/z or intensity is non-finite (NaN/Infinity) or intensity is negative
 */
export async function calculateSplash(peaks: SplashPeak[]): Promise<string> {
  if (peaks.length === 0) {
    throw new RangeError('Cannot calculate SPLASH for an empty spectrum.');
  }

  // Reject unhashable input up front so we never emit a non-canonical or
  // NaN-bearing hash (resolveSplash maps this to a `notApplicable` outcome).
  for (const { mz, intensity } of peaks) {
    if (!Number.isFinite(mz) || !Number.isFinite(intensity) || intensity < 0) {
      throw new RangeError(
        'Cannot calculate SPLASH: peak list contains non-finite or negative values.',
      );
    }
  }

  const basePeak = maxIntensity(peaks);
  if (basePeak <= 0) {
    throw new RangeError(
      'Cannot calculate SPLASH for an all-zero-intensity spectrum.',
    );
  }

  // Work in relative intensity (base peak = RELATIVE_SCALE) for all blocks.
  const relative = peaks.map((p) => ({
    mz: p.mz,
    intensity: (p.intensity / basePeak) * RELATIVE_SCALE,
  }));

  const block1 = calculatePrefilterBlock(relative);
  const block2 = calculateSimilarityBlock(relative);
  const block3 = await calculateHashBlock(relative);

  return `splash10-${block1}-${block2}-${block3}`;
}
