import type { InternalRecord } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

/**
 * Get the filename from a path (browser-compatible alternative to path.basename)
 * @param filepath
 */
function getBasename(filepath: string): string {
  const lastSlash = Math.max(
    filepath.lastIndexOf('/'),
    filepath.lastIndexOf('\\'),
  );
  return lastSlash >= 0 ? filepath.slice(lastSlash + 1) : filepath;
}

/**
 * Remove the extension from a filename (browser-compatible alternative to path.extname)
 * @param filename
 */
function removeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

/**
 * Validates that ACCESSION matches the filename
 * Only validates ACCESSION-filename matching.
 * This rule produces blocking validation errors but no warnings.
 */
export class AccessionMatchRule implements IValidationRule {
  validate(
    record: InternalRecord,
    _originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const basename = removeExtension(getBasename(filename));

    if (record.ACCESSION !== basename) {
      errors.push({
        file: filename,
        line: 1,
        message: `ACCESSION mismatch: File is named '${basename}.txt' but ACCESSION field is '${record.ACCESSION}'. Fix: Either rename the file to '${record.ACCESSION}.txt' or change ACCESSION field to '${basename}'.`,
        type: 'validation',
      });
    }

    return errors;
  }

  getWarnings(): ValidationWarning[] {
    return [];
  }
}
