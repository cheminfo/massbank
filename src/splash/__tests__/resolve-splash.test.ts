import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRecord } from '../../parser/parse-record.js';
import type { SplashPeak } from '../calculate-splash.js';
import { calculateSplash } from '../calculate-splash.js';
import { resolveSplash, resolveSplashFromRecord } from '../resolve-splash.js';

const PEAKS: SplashPeak[] =
  '66.0463:2.1827 105.0698:7.9976 103.0541:4.5676 130.065:8.6025 93.0572:0.2544 79.0542:4.4657 91.0541:2.5671 131.0728:2.6844 115.0541:1.3542 65.0384:0.6554 94.0412:0.5614 116.0494:1.2008 95.049:2.1338 117.0572:100 89.0385:11.7808 77.0385:3.3802 90.0463:35.6373 132.0806:2.343 105.0446:1.771'
    .split(/\s+/)
    .map((pair) => {
      const [mz, intensity] = pair.split(':');
      return { mz: Number(mz), intensity: Number(intensity) };
    });

const CORRECT = 'splash10-014i-4900000000-889a38f7ace2626a0435';
const WRONG = 'splash10-0000-0000000000-000000000000000000ff';

const RECORD_FILE = join(
  import.meta.dirname,
  '../../__tests__/data/MSBNK-test-TST00001.txt',
);

describe('resolveSplash (peak-level)', () => {
  it('MISSING → computes the canonical SPLASH', async () => {
    const out = await resolveSplash(PEAKS);

    expect(out).toStrictEqual({
      status: 'computed',
      splash: CORRECT,
      declared: null,
    });
  });

  it('treats empty-string declared as missing → computed', async () => {
    const out = await resolveSplash(PEAKS, '');

    expect(out.status).toBe('computed');
  });

  it('PRESENT & matching → verified', async () => {
    const out = await resolveSplash(PEAKS, CORRECT);

    expect(out).toStrictEqual({
      status: 'verified',
      splash: CORRECT,
      declared: CORRECT,
    });
  });

  it('PRESENT & wrong → mismatch surfacing BOTH values (no .splash)', async () => {
    const out = await resolveSplash(PEAKS, WRONG);

    expect(out).toStrictEqual({
      status: 'mismatch',
      computed: CORRECT,
      declared: WRONG,
    });
    expect(out).not.toHaveProperty('splash');
  });

  it('empty spectrum → notApplicable (does NOT throw)', async () => {
    const out = await resolveSplash([], CORRECT);

    expect(out).toStrictEqual({
      status: 'notApplicable',
      reason: 'empty-spectrum',
    });
  });

  it('all-zero-intensity spectrum → notApplicable (does NOT throw)', async () => {
    const out = await resolveSplash([
      { mz: 100, intensity: 0 },
      { mz: 200, intensity: 0 },
    ]);

    expect(out).toStrictEqual({
      status: 'notApplicable',
      reason: 'all-zero-intensity',
    });
  });

  it('unhashable spectrum (NaN intensity) → notApplicable, reason unhashable-spectrum', async () => {
    const out = await resolveSplash([
      { mz: 100, intensity: Number.NaN },
      { mz: 200, intensity: Number.NaN },
    ]);

    expect(out).toStrictEqual({
      status: 'notApplicable',
      reason: 'unhashable-spectrum',
    });
  });

  it('does not throw on a large spectrum (computes a verdict)', async () => {
    const peaks: SplashPeak[] = Array.from({ length: 200_000 }, (_, i) => ({
      mz: 50 + i * 0.01,
      intensity: (i % 1000) + 1,
    }));

    const out = await resolveSplash(peaks);

    expect(out.status).toBe('computed');
  });
});

describe('resolveSplashFromRecord (record-text)', () => {
  it('verifies a real record whose PK$SPLASH is correct', async () => {
    const content = await readFile(RECORD_FILE, 'utf8');
    const out = await resolveSplashFromRecord(content);

    expect(out.status).toBe('verified');
  });

  it('computes when a real record has no PK$SPLASH', async () => {
    const content = await readFile(RECORD_FILE, 'utf8');
    const stripped = content.replace(/^PK\$SPLASH:[^\r\n]*\r?\n/m, '');
    const peaks = (parseRecord(stripped).PK$PEAK ?? []).map((p) => ({
      mz: p.mz,
      intensity: p.intensity,
    }));
    const expected = await calculateSplash(peaks);

    const out = await resolveSplashFromRecord(stripped);

    expect(out).toStrictEqual({
      status: 'computed',
      splash: expected,
      declared: null,
    });
  });

  it('reports mismatch (both values) for a tampered PK$SPLASH', async () => {
    const content = await readFile(RECORD_FILE, 'utf8');
    const tampered = content.replace(/^PK\$SPLASH:.*$/m, `PK$SPLASH: ${WRONG}`);
    const peaks = (parseRecord(tampered).PK$PEAK ?? []).map((p) => ({
      mz: p.mz,
      intensity: p.intensity,
    }));
    const computed = await calculateSplash(peaks);

    const out = await resolveSplashFromRecord(tampered);

    expect(out).toStrictEqual({
      status: 'mismatch',
      computed,
      declared: WRONG,
    });
    expect(computed).not.toBe(WRONG);
  });
});
