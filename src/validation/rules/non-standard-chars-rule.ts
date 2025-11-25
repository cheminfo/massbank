import { PositionUtils } from '../../parser/index.js';
import type { Record } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

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
    _options: ValidationRuleOptions,
  ): ValidationError[] {
    void _record;
    void _originalText;
    void _filename;
    void _options;
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
      const char = match[0] || '';
      const codePoint = char.codePointAt(0);
      const hex = codePoint ? `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` : '';

      // Common replacements
      const suggestions = new Map<string, string>([
        ['\u2014', 'Replace em-dash with hyphen'],
        ['\u2013', 'Replace en-dash with hyphen'],
        ['\u201C', 'Replace fancy opening quote with straight quote (")'],
        ['\u201D', 'Replace fancy closing quote with straight quote (")'],
        ['\u2018', "Replace fancy opening apostrophe with straight quote (')"],
        ['\u2019', "Replace fancy closing apostrophe with straight quote (')"],
        ['\u2022', 'Replace bullet point with hyphen (-)'],
        ['\u00A9', 'Replace copyright symbol with (C)'],
        ['\u00AE', 'Replace registered symbol with (R)'],
        ['\u00B0', 'Keep degree symbol or write "deg"'],
      ]);

      const suggestion = suggestions.get(char) || 'Replace with standard ASCII character';

      warnings.push({
        file: filename,
        line,
        column,
        message: `Non-standard character '${char}' (${hex}) found. ${suggestion}`,
      });
    }

    return warnings;
  }
}
