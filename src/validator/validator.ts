import { ParseException, parseRecord } from '../parser/index.js';
import type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from '../types.js';
import { RecordValidator } from '../validation/index.js';

import { FileUtils } from './file-utils.js';

/**
 * Validate a single MassBank record file
 * @param filePath - Path to the .txt file
 * @param options - Validation options (legacy mode, logger)
 * @returns ValidationResult with errors, warnings, and accession
 */
export async function validate(
  filePath: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const accessions: string[] = [];

  // Log if logger provided
  if (options.logger) {
    options.logger.info(`Validating file: ${filePath}`);
  }

  // Read file
  let fileContent: string;
  try {
    fileContent = await FileUtils.readFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      errors: [
        {
          file: filePath,
          message: `Failed to read file: ${message}`,
          type: 'other',
        },
      ],
      warnings: [],
      accessions: [],
      filesProcessed: 0,
    };
  }

  // Parse the record
  let record;
  try {
    record = parseRecord(fileContent);
  } catch (error) {
    if (error instanceof ParseException) {
      errors.push({
        file: filePath,
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
    const ruleErrors = rule.validate(record, fileContent, filePath, {
      legacy: options.legacy,
    });
    errors.push(...ruleErrors);

    const ruleWarnings = rule.getWarnings(record, fileContent, filePath, {
      legacy: options.legacy,
    });
    warnings.push(...ruleWarnings);
  }

  if (record.ACCESSION) {
    accessions.push(record.ACCESSION);
  }

  const success = errors.length === 0;

  if (options.logger) {
    if (success) {
      options.logger.info(`✓ Validation passed for ${filePath}`);
    } else {
      options.logger.error(
        `✗ Validation failed for ${filePath} with ${errors.length} error(s)`,
      );
    }
  }

  return {
    success,
    errors,
    warnings,
    accessions,
    filesProcessed: 1,
  };
}

/**
 * Validate in-memory MassBank record content
 * Useful for browser or API use-cases where the record content is not
 * coming from the filesystem.
 * @param content - Full record text to validate
 * @param filename - Logical filename for error reporting (e.g. 'user-upload.txt')
 * @param options - Validation options (legacy mode, logger)
 * @returns ValidationResult with errors, warnings, and accession
 */
export async function validateContent(
  content: string,
  filename: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const accessions: string[] = [];

  // Parse the record
  let record;
  try {
    record = parseRecord(content);
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
    const ruleErrors = rule.validate(record, content, filename, {
      legacy: options.legacy,
    });
    errors.push(...ruleErrors);

    const ruleWarnings = rule.getWarnings(record, content, filename, {
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
