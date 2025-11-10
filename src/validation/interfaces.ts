import type { Record } from '../record.js';
import type { ValidationError, ValidationWarning } from '../types.js';

/**
 * Interface for validation rules
 * Follows Strategy Pattern and Dependency Inversion Principle
 */
export interface IValidationRule {
  /**
   * Validate a record
   * @param record - The record to validate
   * @param originalText - The original record text (for context)
   * @param filename - The filename (for error reporting)
   * @param options - Validation options
   * @returns Array of errors (empty if valid)
   */
  validate(
    record: Record,
    originalText: string,
    filename: string,
    options: ValidationRuleOptions,
  ): ValidationError[];

  /**
   * Get warnings for a record (non-blocking issues)
   */
  getWarnings(
    record: Record,
    originalText: string,
    filename: string,
    options: ValidationRuleOptions,
  ): ValidationWarning[];
}

export interface ValidationRuleOptions {
  legacy?: boolean;
}
