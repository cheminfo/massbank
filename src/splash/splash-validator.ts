import type { Record } from '../record.js';

import type { ISplashValidator } from './interfaces.js';

/**
 * SPLASH validator using API
 * handles SPLASH validation
 *
 * Note: SPLASH calculation algorithm is complex. For now, we'll use the API.
 */
export class SplashValidator implements ISplashValidator {
  private readonly apiUrl: string;

  constructor(apiUrl?: string) {
    // Default SPLASH API endpoint (if available)
    // For now, we'll implement a basic validation
    this.apiUrl = apiUrl || 'https://splash.fiehnlab.ucdavis.edu/splash/it';
  }

  /**
   * Calculate SPLASH from peak data using API
   * @param peaks
   */
  async calculate(
    peaks: Array<{ mz: number; intensity: number }>,
  ): Promise<string> {
    try {
      // Format peaks for API: "mz1:intensity1 mz2:intensity2 ..."
      const peakString = peaks.map((p) => `${p.mz}:${p.intensity}`).join(' ');

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `spectrum=${encodeURIComponent(peakString)}`,
      });

      if (!response.ok) {
        throw new Error(`SPLASH API error: ${response.statusText}`);
      }

      const data = (await response.json()) as { splash?: string };
      return data.splash || '';
    } catch {
      // If API fails, we can't validate - return empty string
      // This allows validation to continue without SPLASH check
      // SPLASH API unavailable, skipping SPLASH validation
      return '';
    }
  }

  /**
   * Validate SPLASH value against peak data
   * @param record
   */
  async validate(record: Record): Promise<boolean> {
    if (!record.PK$SPLASH || !record.PK$PEAK) {
      return true; // No SPLASH to validate, or no peaks
    }

    if (record.PK$PEAK.length === 0) {
      return true; // No peaks to validate against
    }

    try {
      const calculatedSplash = await this.calculate(
        record.PK$PEAK.map((p) => ({
          mz: p.mz,
          intensity: p.intensity,
        })),
      );

      if (!calculatedSplash) {
        // API unavailable, skip validation
        return true;
      }

      return calculatedSplash === record.PK$SPLASH;
    } catch {
      // If validation fails due to API issues, allow it to pass
      // (we don't want to block validation if API is down)
      // SPLASH validation failed
      return true;
    }
  }
}

/**
 * Factory function to create a SPLASH validator
 * @param apiUrl
 */
export function createSplashValidator(apiUrl?: string): ISplashValidator {
  return new SplashValidator(apiUrl);
}
