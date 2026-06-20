import { describe, expect, it } from 'vitest';

import type { SplashPeak } from '../calculate-splash.js';
import { calculateSplash } from '../calculate-splash.js';

/**
 * Parse a reference spectrum string ("mz:int mz:int ...") into peaks.
 * @param spectrum - space-separated "mz:intensity" pairs
 * @returns parsed peaks
 */
function parseSpectrum(spectrum: string): SplashPeak[] {
  return spectrum
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [mz, intensity] = pair.split(':');
      return { mz: Number(mz), intensity: Number(intensity) };
    });
}

// Reference vectors from berlinguyinca/spectra-hash python/tests/test_splash.py
const VECTORS = [
  {
    name: 'reference vector 1',
    spectrum:
      '66.0463:2.1827 105.0698:7.9976 103.0541:4.5676 130.065:8.6025 93.0572:0.2544 79.0542:4.4657 91.0541:2.5671 131.0728:2.6844 115.0541:1.3542 65.0384:0.6554 94.0412:0.5614 116.0494:1.2008 95.049:2.1338 117.0572:100 89.0385:11.7808 77.0385:3.3802 90.0463:35.6373 132.0806:2.343 105.0446:1.771',
    expected: 'splash10-014i-4900000000-889a38f7ace2626a0435',
  },
  {
    name: 'reference vector 2',
    spectrum:
      '303.07:100 662.26:1.2111 454.91:1.2023 433.25:0.8864 432.11:2.308 592.89:3.9052 259.99:0.6406 281.14:1.2549 451.34:1.1847 499.85:1.2374 482.14:2.4133 450:23.5191 483:1.0004 285.25:1.448 253.1:46.5731 254.11:3.247 259.13:6.9241 304.14:17.2795',
    expected: 'splash10-0udi-0049200000-ef488ecacceeaaadb4a2',
  },
];

const SPLASH_SHAPE = /^splash10-[0-9a-z]{4}-[0-9a-z]{10}-[0-9a-f]{20}$/;

describe('calculateSplash', () => {
  it.each(VECTORS)(
    'reproduces $name byte-for-byte',
    async ({ spectrum, expected }) => {
      const result = await calculateSplash(parseSpectrum(spectrum));

      expect(result).toBe(expected);
    },
  );

  it('throws RangeError for an empty spectrum', async () => {
    await expect(calculateSplash([])).rejects.toThrow(RangeError);
  });

  it('throws RangeError for an all-zero-intensity spectrum', async () => {
    const peaks: SplashPeak[] = [
      { mz: 100, intensity: 0 },
      { mz: 200, intensity: 0 },
    ];

    await expect(calculateSplash(peaks)).rejects.toThrow(RangeError);
  });

  it('throws RangeError for a non-finite m/z', async () => {
    await expect(
      calculateSplash([
        { mz: Number.NaN, intensity: 100 },
        { mz: 50, intensity: 50 },
      ]),
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError for a negative intensity', async () => {
    await expect(
      calculateSplash([
        { mz: 100, intensity: -5 },
        { mz: 50, intensity: 50 },
      ]),
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError for an Infinity intensity', async () => {
    await expect(
      calculateSplash([
        { mz: 100, intensity: Number.POSITIVE_INFINITY },
        { mz: 50, intensity: 50 },
      ]),
    ).rejects.toThrow(RangeError);
  });

  it('produces a valid hash for a single peak', async () => {
    const result = await calculateSplash([{ mz: 117.0572, intensity: 100 }]);

    expect(result).toMatch(SPLASH_SHAPE);
    expect(result).not.toContain('NaN');
  });

  it('produces a valid hash for duplicate m/z values', async () => {
    const result = await calculateSplash([
      { mz: 100, intensity: 5 },
      { mz: 100, intensity: 50 },
      { mz: 200, intensity: 100 },
    ]);

    expect(result).toMatch(SPLASH_SHAPE);
    expect(result).not.toContain('NaN');
  });

  it('produces a valid hash for very large m/z values', async () => {
    const result = await calculateSplash([
      { mz: 1, intensity: 1 },
      { mz: 999999.9999, intensity: 100 },
    ]);

    expect(result).toMatch(SPLASH_SHAPE);
    expect(result).not.toContain('NaN');
  });

  it('handles a very large spectrum without a stack overflow', async () => {
    const peaks: SplashPeak[] = Array.from({ length: 200_000 }, (_, i) => ({
      mz: 50 + i * 0.01,
      intensity: (i % 1000) + 1,
    }));

    const result = await calculateSplash(peaks);

    expect(result).toMatch(SPLASH_SHAPE);
  });
});
