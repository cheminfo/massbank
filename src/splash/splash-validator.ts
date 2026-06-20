import type { InternalRecord } from '../record.js';

import type { SplashPeak } from './calculate-splash.js';
import { calculateSplash } from './calculate-splash.js';
import type { ISplashValidator } from './interfaces.js';

/**
 * SPLASH validator backed by the local, offline {@link calculateSplash}.
 *
 * Computes the canonical SPLASH from a record's peak list and compares it to
 * the record's declared `PK$SPLASH`. No network call, no fail-open: a record
 * whose `PK$SPLASH` does not match its peaks is reported invalid.
 */
export class SplashValidator implements ISplashValidator {
  /**
   * Calculate the SPLASH for a peak list (delegates to {@link calculateSplash}).
   * @param peaks - peaks (m/z and intensity)
   * @returns the calculated SPLASH
   */
  async calculate(peaks: SplashPeak[]): Promise<string> {
    return calculateSplash(peaks);
  }

  /**
   * Validate a record's `PK$SPLASH` against its peak list.
   *
   * Returns true (nothing to check) when the record has no `PK$SPLASH` or no
   * peaks. Otherwise recomputes the SPLASH locally and compares.
   * @param record - the record to validate
   * @returns true if the SPLASH is absent/not-applicable or matches the peaks
   */
  async validate(record: InternalRecord): Promise<boolean> {
    if (!record.PK$SPLASH || !record.PK$PEAK || record.PK$PEAK.length === 0) {
      return true;
    }

    const calculated = await this.calculate(
      record.PK$PEAK.map((p) => ({ mz: p.mz, intensity: p.intensity })),
    );

    return calculated === record.PK$SPLASH;
  }
}

/**
 * Factory function to create a SPLASH validator.
 * @returns a new {@link SplashValidator}
 */
export function createSplashValidator(): ISplashValidator {
  return new SplashValidator();
}
