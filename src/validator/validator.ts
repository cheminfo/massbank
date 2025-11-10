import type { FifoLogger } from 'fifo-logger';

import { ParseException, parseRecord } from '../parser/index.js';
import type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from '../types.js';
import { RecordValidator } from '../validation/index.js';
import type { IValidationRule } from '../validation/interfaces.js';

import { FileUtils } from './file-utils.js';

/**
 * Main validator for MassBank records
 * Follows Single Responsibility: Orchestrates validation process
 * Follows Dependency Inversion: Uses interfaces for validation rules
 */
export class MassBankValidator {
  private readonly recordValidator: RecordValidator;
  private readonly logger?: FifoLogger;

  constructor(recordValidator?: RecordValidator, logger?: FifoLogger) {
    this.recordValidator = recordValidator || new RecordValidator();
    this.logger = logger;
  }

  /**
   * Validate one or more MassBank record files
   * @param paths
   * @param options
   */
  async validate(
    paths: string | string[],
    options: ValidationOptions = {},
  ): Promise<ValidationResult> {
    const filePaths = Array.isArray(paths) ? paths : [paths];
    const resolvedFiles = await FileUtils.resolvePaths(filePaths);

    if (resolvedFiles.length === 0) {
      const error: ValidationError = {
        file: Array.isArray(paths) ? paths.join(', ') : paths,
        message: 'No files found for validation.',
        type: 'other',
      };
      return {
        success: false,
        errors: [error],
        warnings: [],
        accessions: [],
        filesProcessed: 0,
      };
    }

    if (this.logger) {
      this.logger.info(`Found ${resolvedFiles.length} files for processing`);
    }

    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];
    const accessions: string[] = [];

    // Process all files
    for (const filePath of resolvedFiles) {
      try {
        const fileContent = await FileUtils.readFile(filePath);
        const result = await this.validateFile(filePath, fileContent, options);

        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
        if (result.accession) {
          accessions.push(result.accession);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        allErrors.push({
          file: filePath,
          message: `Error processing file: ${errorMessage}`,
          type: error instanceof ParseException ? 'parse' : 'other',
        });
      }
    }

    // Check for duplicate accessions
    const duplicateErrors = this.checkDuplicates(accessions);
    allErrors.push(...duplicateErrors);

    const success = allErrors.length === 0;

    return {
      success,
      errors: allErrors,
      warnings: allWarnings,
      accessions: [...new Set(accessions)], // Unique accessions
      filesProcessed: resolvedFiles.length,
    };
  }

  /**
   * Validate a single file
   * @param filePath
   * @param content
   * @param options
   */
  private async validateFile(
    filePath: string,
    content: string,
    options: ValidationOptions,
  ): Promise<{
    errors: ValidationError[];
    warnings: ValidationWarning[];
    accession?: string;
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Parse the record
    let record;
    try {
      record = parseRecord(content);
    } catch (error) {
      if (error instanceof ParseException) {
        errors.push({
          file: filePath,
          line: error.parseError.line,
          column: error.parseError.column,
          message: error.parseError.message,
          type: 'parse',
        });
        return { errors, warnings };
      }
      throw error;
    }

    // Apply validation rules
    const rules = this.recordValidator.getRules();
    for (const rule of rules) {
      const ruleErrors = rule.validate(record, content, filePath, {
        legacy: options.legacy,
      });
      errors.push(...ruleErrors);

      const ruleWarnings = rule.getWarnings(record, content, filePath, {
        legacy: options.legacy,
      });
      warnings.push(...ruleWarnings);
    }

    return {
      errors,
      warnings,
      accession: record.ACCESSION,
    };
  }

  /**
   * Check for duplicate accessions
   * @param accessions
   */
  private checkDuplicates(accessions: string[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const accession of accessions) {
      if (seen.has(accession)) {
        duplicates.add(accession);
      } else {
        seen.add(accession);
      }
    }

    if (duplicates.size > 0) {
      errors.push({
        file: '',
        message: `There are duplicates in all accessions: ${Array.from(duplicates).join(', ')}`,
        type: 'duplicate',
      });
    }

    return errors;
  }

  /**
   * Add a custom validation rule
   * @param rule
   */
  addRule(rule: IValidationRule): void {
    this.recordValidator.addRule(rule);
  }
}

/**
 * Factory function to create a validator
 * @param logger
 */
export function createValidator(logger?: FifoLogger): MassBankValidator {
  return new MassBankValidator(undefined, logger);
}

/**
 * Convenience function to validate files
 * @param paths
 * @param options
 */
export async function validate(
  paths: string | string[],
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const validator = createValidator(options.logger);
  return validator.validate(paths, options);
}
