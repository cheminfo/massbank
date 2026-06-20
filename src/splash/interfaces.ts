import type { InternalRecord } from '../record.js';

import type { SplashPeak } from './calculate-splash.js';

/**
 * Interface for SPLASH calculation and validation
 */
export interface ISplashValidator {
  /**
   * Calculate SPLASH from peak data
   * @param peaks - Array of peaks (m/z and intensity)
   * @returns The calculated SPLASH value
   */
  calculate(peaks: SplashPeak[]): Promise<string>;

  /**
   * Validate SPLASH value against peak data
   * @param record - The record containing SPLASH and peaks
   * @returns true if SPLASH is valid, false otherwise
   */
  validate(record: InternalRecord): Promise<boolean>;
}
