import type { InternalRecord } from '../record.js';
import type { ValidationError, ValidationWarning } from '../types.js';

/**
 * Interface for validation rules
 */
export interface IValidationRule {
  /**
   * Validate a record. May be synchronous or asynchronous — the validation
   * pipeline awaits the result, so sync rules can return an array directly while
   * async rules (e.g. SPLASH, which hashes via Web Crypto) return a Promise.
   * @param record - The record to validate
   * @param originalText - The original record text (for context)
   * @param filename - The filename (for error reporting)
   * @param options - Validation options
   * @returns Array of errors (empty if valid), or a Promise of one
   */
  validate(
    record: InternalRecord,
    originalText: string,
    filename: string,
    options: ValidationRuleOptions,
  ): ValidationError[] | Promise<ValidationError[]>;

  /**
   * Get warnings for a record (non-blocking issues)
   */
  getWarnings(
    record: InternalRecord,
    originalText: string,
    filename: string,
    options: ValidationRuleOptions,
  ): ValidationWarning[];
}

export interface ValidationRuleOptions {
  legacy?: boolean;
}
