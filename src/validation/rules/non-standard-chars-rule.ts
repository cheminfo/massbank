import { PositionUtils } from '../../parser/index.js';
import type { Record } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type {
  IValidationRule,
  ValidationRuleOptions,
} from '../interfaces.js';

/**
 * Pattern for allowed characters (from Java Validator).
 * Note: We deliberately allow both LF (`\n`) and CR (`\r`) here so CRLF
 * line endings do not trigger non-standard character warnings. The Java CLI
 * treats CR as non-standard only via logging; for this library we avoid
 * warning on platform-specific line endings while still flagging real
 * non-ASCII issues.
 */
const NON_STANDARD_CHARS_PATTERN =
  /[^\w\r\n\-[\]."\\ ;:–=+,|(){}/$%@'°!?#`^*&<>µáćÉéóäöü©]/;

/**
 * Validates non-standard characters in the record
 * Only validates character set.
 * This rule is warning-only and never produces blocking validation errors.
 */
export class NonStandardCharsRule implements IValidationRule {
  validate(
    _record: Record,
    _originalText: string,
    _filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): ValidationError[] {
    return [];
  }

  getWarnings(
    record: Record,
    originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Skip deprecated records
    if (record.DEPRECATED) {
      return warnings;
    }

    const match = NON_STANDARD_CHARS_PATTERN.exec(originalText);
    if (match?.index !== undefined) {
      const { line, column } = PositionUtils.getLineColumn(
        originalText,
        match.index,
      );
      warnings.push({
        file: filename,
        line,
        column,
        message:
          'Non standard ASCII character found. This might be an error. Please check carefully.',
      });
    }

    return warnings;
  }
}
