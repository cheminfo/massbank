import type { InternalRecord } from '../../record.js';
import { calculateSplash } from '../../splash/calculate-splash.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

/**
 * Validates that a record's `PK$SPLASH` matches the SPLASH computed locally from
 * its peak list (mirrors the Java original's SPLASH check). Skips records that
 * declare no `PK$SPLASH` or have no peaks. Blocking error on mismatch; no
 * warnings. The hash is computed offline via Web Crypto, so this rule is async.
 */
export class SplashRule implements IValidationRule {
  async validate(
    record: InternalRecord,
    _originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): Promise<ValidationError[]> {
    if (!record.PK$SPLASH || !record.PK$PEAK || record.PK$PEAK.length === 0) {
      return [];
    }

    let calculated: string;
    try {
      calculated = await calculateSplash(
        record.PK$PEAK.map((p) => ({ mz: p.mz, intensity: p.intensity })),
      );
    } catch (error) {
      // Degenerate peaks (all-zero / unhashable) can't produce a SPLASH, so we
      // can't verify the declared one — skip rather than crash the pipeline.
      // Genuinely malformed peak data is caught by the serialization rule.
      if (error instanceof RangeError) return [];
      throw error;
    }

    if (calculated === record.PK$SPLASH) {
      return [];
    }

    return [
      {
        file: filename,
        message: `SPLASH mismatch: PK$SPLASH is '${record.PK$SPLASH}' but the peak list hashes to '${calculated}'. Fix: recompute PK$SPLASH from the peaks, or correct the peak list.`,
        type: 'splash',
      },
    ];
  }

  getWarnings(): ValidationWarning[] {
    return [];
  }
}
