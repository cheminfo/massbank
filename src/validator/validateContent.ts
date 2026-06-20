import type { TextData } from 'cheminfo-types';
import { ensureString } from 'ensure-string';

import { ParseException } from '../parser/exceptions.ts';
import { parseRecord } from '../parser/parse-record.ts';
import type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from '../types.ts';
import { RecordValidator } from '../validation/validator.ts';

/**
 * Validate in-memory MassBank record content (browser-compatible)
 * Useful for browser or API use-cases where the record content is not
 * coming from the filesystem. This function has no Node.js dependencies.
 * @param content - Full record text to validate
 * @param filename - Logical filename for error reporting (e.g. 'user-upload.txt')
 * @param options - Validation options (legacy mode, logger)
 * @returns ValidationResult with errors, warnings, and accession
 */

export async function validateContent(
  content: TextData,
  filename: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const accessions: string[] = [];

  const text = ensureString(content);

  // Parse the record
  let record;
  try {
    record = parseRecord(text);
  } catch (error) {
    if (error instanceof ParseException) {
      errors.push({
        file: filename,
        line: error.parseError.line,
        column: error.parseError.column,
        message: error.parseError.message,
        type: 'parse',
      });
      return {
        success: false,
        errors,
        warnings,
        accessions,
        filesProcessed: 1,
      };
    }
    throw error;
  }

  // Apply validation rules
  const recordValidator = new RecordValidator();
  const rules = recordValidator.getRules();

  for (const rule of rules) {
    try {
      // eslint-disable-next-line no-await-in-loop -- rules run in a defined order
      const ruleErrors = await rule.validate(record, text, filename, {
        legacy: options.legacy,
      });
      errors.push(...ruleErrors);
    } catch (error) {
      // A rule throwing must never crash the run or silently pass — surface it.
      errors.push({
        file: filename,
        message: `Validation rule failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'other',
      });
    }

    const ruleWarnings = rule.getWarnings(record, text, filename, {
      legacy: options.legacy,
    });
    warnings.push(...ruleWarnings);
  }

  if (record.ACCESSION) {
    accessions.push(record.ACCESSION);
  }

  const success = errors.length === 0;

  return {
    success,
    errors,
    warnings,
    accessions,
    filesProcessed: 1,
  };
}
