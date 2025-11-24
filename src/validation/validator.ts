import type { IValidationRule } from './interfaces.js';
import {
  AccessionMatchRule,
  NonStandardCharsRule,
  SerializationRule,
  UnrecognizedFieldRule,
} from './rules/index.js';

/**
 * Validator that applies all validation rules to a record
 */
export class RecordValidator {
  private readonly rules: IValidationRule[];

  constructor(rules?: IValidationRule[]) {
    // Default rules (can be overridden via dependency injection)
    this.rules = rules || [
      new AccessionMatchRule(),
      new NonStandardCharsRule(),
      new SerializationRule(),
      new UnrecognizedFieldRule(),
    ];
  }

  /**
   * Add a validation rule
   * @param rule
   */
  addRule(rule: IValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Get all validation rules
   */
  getRules(): readonly IValidationRule[] {
    return this.rules;
  }
}
