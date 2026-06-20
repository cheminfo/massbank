import { readFile } from 'node:fs/promises';

import { ParseException, parseRecord } from '../parser/index.ts';
import type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from '../types.ts';
import { RecordValidator } from '../validation/index.ts';

/**
 * Validate a single MassBank record file (Node.js only)
 * For browser usage, use validateContent() instead.
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
    fileContent = await readFile(filePath, 'utf8');
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
    try {
      // eslint-disable-next-line no-await-in-loop -- rules run in a defined order
      const ruleErrors = await rule.validate(record, fileContent, filePath, {
        legacy: options.legacy,
      });
      errors.push(...ruleErrors);
    } catch (error) {
      // A rule throwing must never crash the run or silently pass — surface it.
      errors.push({
        file: filePath,
        message: `Validation rule failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'other',
      });
    }

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
