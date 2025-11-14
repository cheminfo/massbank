import { PositionUtils } from '../../parser/index.js';
import type { Record } from '../../record.js';
import { serializeRecord } from '../../serializer/index.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type {
  IValidationRule,
  ValidationRuleOptions,
} from '../interfaces.js';

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
        const { line, column } = PositionUtils.getLineColumn(normalizedOriginal, diffPosition);
        errors.push({
          file: filename,
          line,
          column,
          message:
            'File content differs from generated record string. This might be a code problem. Please Report!',
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
