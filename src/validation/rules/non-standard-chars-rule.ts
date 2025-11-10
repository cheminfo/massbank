import type { Record } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type {
  IValidationRule,
  ValidationRuleOptions,
} from '../interfaces.js';

/**
 * Pattern for allowed characters (from Java Validator)
 */
const NON_STANDARD_CHARS_PATTERN =
  /[^\w\n\-[\]."\\ ;:–=+,|(){}/$%@'°!?#`^*&<>µáćÉéóäöü©]/;

/**
 * Validates non-standard characters in the record
 * Single Responsibility: Only validates character set
 */
export class NonStandardCharsRule implements IValidationRule {
  validate(): ValidationError[] {
    return [];
  }

  getWarnings(
    record: Record,
    originalText: string,
    filename: string,
    _options: ValidationRuleOptions,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Skip deprecated records
    if (record.DEPRECATED) {
      return warnings;
    }

    const match = NON_STANDARD_CHARS_PATTERN.exec(originalText);
    if (match?.index !== undefined) {
      const position = match.index + match[0].length;
      if (position < originalText.length) {
        const { line, column } = this.getLineColumn(originalText, position);
        warnings.push({
          file: filename,
          line,
          column,
          message:
            'Non standard ASCII character found. This might be an error. Please check carefully.',
        });
      }
    }

    return warnings;
  }

  private getLineColumn(
    text: string,
    position: number,
  ): { line: number; column: number } {
    const lines = text.split(/\r?\n/);
    let offset = 0;
    let lineNumber = 1;
    let column = 1;

    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i]!.length + 1; // +1 for newline
      if (offset + lineLength > position) {
        lineNumber = i + 1;
        column = position - offset + 1;
        break;
      }
      offset += lineLength;
    }

    return { line: lineNumber, column };
  }
}
