import { PositionUtils } from '../../parser/index.js';
import type { Record } from '../../record.js';
import { serializeRecord } from '../../serializer/index.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

/**
 * Validates serialization round-trip (parse -> serialize -> compare)
 * Only validates serialization consistency.
 * This rule produces blocking validation errors but no warnings.
 */
export class SerializationRule implements IValidationRule {
  validate(
    record: Record,
    originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    try {
      const serialized = serializeRecord(record);
      // eslint-disable-next-line unicorn/prefer-string-replace-all
      const normalizedOriginal = originalText.replace(/\r\n?/g, '\n');

      // Find first difference
      const diffPosition = this.findFirstDifference(
        normalizedOriginal,
        serialized,
      );

      if (diffPosition !== -1) {
        const { line, column } = PositionUtils.getLineColumn(
          normalizedOriginal,
          diffPosition,
        );

        // Get context around the difference for better error message
        const originalLine = normalizedOriginal.split('\n')[line - 1] || '';
        const serializedLine = serialized.split('\n')[line - 1] || '';

        let message = 'File formatting issue detected (round-trip validation failed).';

        // Provide specific guidance based on common issues
        if (originalLine !== serializedLine) {
          if (originalLine.includes('  ') && serializedLine.includes(' ')) {
            message += ' Check for extra spaces or inconsistent spacing.';
          } else if (!serializedLine.trim()) {
            message += ' This line may contain unrecognized fields that were ignored during parsing.';
          } else {
            message += ` Expected: "${serializedLine.trim()}" but found: "${originalLine.trim()}"`;
          }
        }

        errors.push({
          file: filename,
          line,
          column,
          message,
          type: 'serialization',
        });
      }
    } catch (error) {
      errors.push({
        file: filename,
        message: `Serialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'serialization',
      });
    }

    return errors;
  }

  getWarnings(): ValidationWarning[] {
    return [];
  }

  private findFirstDifference(str1: string, str2: string): number {
    const minLength = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLength; i++) {
      if (str1[i] !== str2[i]) {
        return i;
      }
    }
    if (str1.length !== str2.length) {
      return minLength;
    }
    return -1;
  }
}
