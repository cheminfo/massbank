import path from 'node:path';

import type { Record } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type {
  IValidationRule,
  ValidationRuleOptions,
} from '../interfaces.js';

/**
 * Validates that ACCESSION matches the filename
 * Single Responsibility: Only validates ACCESSION-filename matching
 */
export class AccessionMatchRule implements IValidationRule {
  validate(
    record: Record,
    _originalText: string,
    filename: string,
    _options: ValidationRuleOptions,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const basename = path.basename(filename, path.extname(filename));

    if (record.ACCESSION !== basename) {
      errors.push({
        file: filename,
        line: 1,
        message: `ACCESSION ${record.ACCESSION} does not match filename '${filename}'`,
        type: 'validation',
      });
    }

    return errors;
  }

  getWarnings(): ValidationWarning[] {
    return [];
  }
}
