import { describe, expect, it } from 'vitest';

import type { InternalRecord } from '../../../record.js';
import { SplashRule } from '../splash-rule.js';

// Reference vector 1 peaks + its canonical SPLASH.
const PEAKS =
  '66.0463:2.1827 105.0698:7.9976 103.0541:4.5676 130.065:8.6025 93.0572:0.2544 79.0542:4.4657 91.0541:2.5671 131.0728:2.6844 115.0541:1.3542 65.0384:0.6554 94.0412:0.5614 116.0494:1.2008 95.049:2.1338 117.0572:100 89.0385:11.7808 77.0385:3.3802 90.0463:35.6373 132.0806:2.343 105.0446:1.771'
    .split(/\s+/)
    .map((pair) => {
      const [mz, intensity] = pair.split(':');
      return {
        mz: Number(mz),
        intensity: Number(intensity),
        relativeIntensity: 0,
      };
    });

const CORRECT_SPLASH = 'splash10-014i-4900000000-889a38f7ace2626a0435';
const WRONG_SPLASH = 'splash10-0000-0000000000-0000000000000000000a';

function makeRecord(overrides: Partial<InternalRecord>): InternalRecord {
  return { ACCESSION: 'MSBNK-test-TST00001', ...overrides };
}

describe('SplashRule', () => {
  const rule = new SplashRule();

  it('produces no error when PK$SPLASH matches the peaks', async () => {
    const record = makeRecord({ PK$PEAK: PEAKS, PK$SPLASH: CORRECT_SPLASH });
    const errors = await rule.validate(record, '', 'file.txt', {});

    expect(errors).toStrictEqual([]);
  });

  it('produces a blocking splash error when PK$SPLASH does not match', async () => {
    const record = makeRecord({ PK$PEAK: PEAKS, PK$SPLASH: WRONG_SPLASH });
    const errors = await rule.validate(record, '', 'file.txt', {});

    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe('splash');
    expect(errors[0]?.message).toContain(CORRECT_SPLASH);
  });

  it('skips (no error) when there is no PK$SPLASH', async () => {
    const record = makeRecord({ PK$PEAK: PEAKS });

    await expect(
      rule.validate(record, '', 'file.txt', {}),
    ).resolves.toStrictEqual([]);
  });

  it('skips (no error) when there are no peaks', async () => {
    const record = makeRecord({ PK$PEAK: [], PK$SPLASH: CORRECT_SPLASH });

    await expect(
      rule.validate(record, '', 'file.txt', {}),
    ).resolves.toStrictEqual([]);
  });

  it('skips (does not throw) when peaks are unhashable (all-zero intensity)', async () => {
    const record = makeRecord({
      PK$SPLASH: CORRECT_SPLASH,
      PK$PEAK: [
        { mz: 100, intensity: 0, relativeIntensity: 0 },
        { mz: 200, intensity: 0, relativeIntensity: 0 },
      ],
    });

    await expect(
      rule.validate(record, '', 'file.txt', {}),
    ).resolves.toStrictEqual([]);
  });

  it('produces no warnings', () => {
    expect(rule.getWarnings()).toStrictEqual([]);
  });
});
