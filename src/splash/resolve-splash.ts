import type { TextData } from 'cheminfo-types';
import { ensureString } from 'ensure-string';

import { parseRecord } from '../parser/parse-record.js';

import type { SplashPeak } from './calculate-splash.js';
import { calculateSplash } from './calculate-splash.js';

/**
 * Outcome of reconciling a declared SPLASH against the canonical one computed
 * from the peaks. A pure verdict — the caller decides what to do with it.
 *
 * - `computed`: the record had no SPLASH; here is the canonical one.
 * - `verified`: the declared SPLASH matches the computed one.
 * - `mismatch`: the declared SPLASH is wrong; both values are surfaced and
 *   there is deliberately no single `splash` field, so a wrong value cannot be
 *   trusted by accident. The computed value is canonical.
 * - `notApplicable`: no SPLASH exists for this spectrum (no peaks, or all-zero
 *   intensity) — returned instead of throwing, so callers never crash.
 */
export type SplashOutcome =
  | { status: 'computed'; splash: string; declared: null }
  | { status: 'verified'; splash: string; declared: string }
  | { status: 'mismatch'; computed: string; declared: string }
  | {
      status: 'notApplicable';
      reason: 'empty-spectrum' | 'all-zero-intensity' | 'unhashable-spectrum';
    };

/**
 * Classify why a non-hashable spectrum has no SPLASH.
 * @param peaks - the peaks that could not be hashed
 * @returns the reason: empty, strictly all-zero intensity, or otherwise
 *   unhashable (e.g. NaN/Infinity/negative intensities or NaN m/z)
 */
function unhashableReason(
  peaks: SplashPeak[],
): 'empty-spectrum' | 'all-zero-intensity' | 'unhashable-spectrum' {
  if (peaks.length === 0) return 'empty-spectrum';
  if (peaks.every((p) => p.intensity === 0)) return 'all-zero-intensity';
  return 'unhashable-spectrum';
}

/**
 * Reconcile a declared SPLASH against the canonical one computed from peaks.
 *
 * Pure inspection: it never mutates and never throws for an unhashable
 * spectrum (it returns `notApplicable` instead). Generation (`fillSplash`) and
 * pipeline validation (`SplashRule`) are kept separate so consumers can choose
 * their own flow (auto-fill vs user-approved).
 * @param peaks - the spectrum's peaks
 * @param declared - the declared `PK$SPLASH`, if any (nullish/empty = missing)
 * @returns the reconciliation outcome
 */
export async function resolveSplash(
  peaks: SplashPeak[],
  declared?: string | null,
): Promise<SplashOutcome> {
  let computed: string;
  try {
    computed = await calculateSplash(peaks);
  } catch (error) {
    if (error instanceof RangeError) {
      return { status: 'notApplicable', reason: unhashableReason(peaks) };
    }
    throw error;
  }

  if (!declared) {
    return { status: 'computed', splash: computed, declared: null };
  }
  if (declared === computed) {
    return { status: 'verified', splash: computed, declared };
  }
  return { status: 'mismatch', computed, declared };
}

/**
 * Reconcile the `PK$SPLASH` of a MassBank record text against its peaks.
 *
 * Convenience over {@link resolveSplash} that parses the record. Throws only if
 * the record itself cannot be parsed (a distinct concern from SPLASH).
 * @param content - the MassBank record text
 * @returns the reconciliation outcome
 */
export async function resolveSplashFromRecord(
  content: TextData,
): Promise<SplashOutcome> {
  const record = parseRecord(ensureString(content));
  const peaks = (record.PK$PEAK ?? []).map((p) => ({
    mz: p.mz,
    intensity: p.intensity,
  }));
  return resolveSplash(peaks, record.PK$SPLASH ?? null);
}
