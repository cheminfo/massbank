import { describe, expect, it } from 'vitest';

import type { InternalRecord } from '../../record.js';
import { calculateSplash } from '../calculate-splash.js';
import { createSplashValidator } from '../splash-validator.js';

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

function makeRecord(overrides: Partial<InternalRecord>): InternalRecord {
  return { ACCESSION: 'MSBNK-test-TST00001', ...overrides };
}

describe('SplashValidator (local, offline)', () => {
  it('calculate() matches the standalone calculateSplash', async () => {
    const validator = createSplashValidator();

    await expect(validator.calculate(PEAKS)).resolves.toBe(
      await calculateSplash(PEAKS),
    );
  });

  it('validate() returns true for a record whose PK$SPLASH is correct', async () => {
    const validator = createSplashValidator();
    const record = makeRecord({ PK$PEAK: PEAKS, PK$SPLASH: CORRECT_SPLASH });

    await expect(validator.validate(record)).resolves.toBe(true);
  });

  it('validate() returns false when PK$SPLASH is tampered (no fail-open)', async () => {
    const validator = createSplashValidator();
    const record = makeRecord({
      PK$PEAK: PEAKS,
      PK$SPLASH: 'splash10-0000-0000000000-0000000000000000000a',
    });

    await expect(validator.validate(record)).resolves.toBe(false);
  });

  it('validate() skips (returns true) when there is no PK$SPLASH', async () => {
    const validator = createSplashValidator();
    const record = makeRecord({ PK$PEAK: PEAKS });

    await expect(validator.validate(record)).resolves.toBe(true);
  });

  it('validate() skips (returns true) when there are no peaks', async () => {
    const validator = createSplashValidator();
    const record = makeRecord({ PK$PEAK: [], PK$SPLASH: CORRECT_SPLASH });

    await expect(validator.validate(record)).resolves.toBe(true);
  });
});
