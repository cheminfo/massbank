import type { ParseError } from '../types.js';

/**
 * Utility functions for position calculations
 * Handle position/line/column calculations
 */
export const PositionUtils = {
  /**
   * Get character position from line and column (both 1-based).
   * Converts 1-based line/column to a 0-based character offset in the text.
   * @param text - The full text being parsed (used to determine actual newline lengths)
   * @param lineIndex - Line number (1-based)
   * @param column - Column number (1-based)
   * @returns 0-based character position in the original text
   */
  getPosition(text: string, lineIndex: number, column: number): number {
    // Convert 1-based line/column to 0-based for internal calculation
    const zeroBasedLine = lineIndex - 1;
    const zeroBasedColumn = column - 1;

    // Match lines with their actual newline separators to get correct lengths
    const lineRegex = /^(?<content>.*?)(?<newline>\r\n|\r|\n|$)/gm;
    let match: RegExpExecArray | null;
    let offset = 0;
    let currentLine = 0;

    while ((match = lineRegex.exec(text)) !== null) {
      if (currentLine === zeroBasedLine) {
        // Found the target line, add the column offset
        return offset + zeroBasedColumn;
      }

      const lineContent = match.groups?.content ?? '';
      const newlineSeparator = match.groups?.newline ?? '';
      
      // Move offset past the line content and its newline separator
      offset += lineContent.length + newlineSeparator.length;
      currentLine++;

      // If we've processed all text, break to avoid infinite loop
      if (newlineSeparator === '' || match.index + match[0].length >= text.length) {
        break;
      }
    }

    // If we didn't find the line, return the current offset plus column
    return offset + zeroBasedColumn;
  },

  /**
   * Create a ParseError from a 0-based character position.
   * Converts the position to 1-based line and column numbers.
   * Clamps position to valid range [0, text.length] to ensure correct line/column calculation.
   * @param text - The full text being parsed
   * @param position - 0-based character offset in the text
   * @param message - Error message describing the problem
   * @returns ParseError with 1-based line and column
   */
  createParseError(
    text: string,
    position: number,
    message: string,
  ): ParseError {
    // Clamp position to valid range to prevent invalid line/column calculation
    const clampedPosition = Math.max(0, Math.min(position, text.length));

    // Delegate to getLineColumn to avoid duplicating logic
    const { line, column } = this.getLineColumn(text, clampedPosition);

    return {
      position: clampedPosition,
      message,
      line,
      column,
    };
  },

  /**
   * Get line and column from a 0-based character position.
   * Converts the position to 1-based line and column numbers.
   * Clamps position to valid range [0, text.length] and correctly handles the last line.
   * @param text - The full text being parsed
   * @param position - 0-based character offset in the text
   * @returns Object with 1-based line and column
   */
  getLineColumn(
    text: string,
    position: number,
  ): { line: number; column: number } {
    // Clamp position to valid range [0, text.length]
    const clampedPosition = Math.max(0, Math.min(position, text.length));

    // Match lines with their actual newline separators to get correct lengths
    // This regex captures line content followed by the newline (CRLF, LF, or CR)
    const lineRegex = /^(?<content>.*?)(?<newline>\r\n|\r|\n|$)/gm;
    let match: RegExpExecArray | null;
    let offset = 0;
    let lineNumber = 1;

    while ((match = lineRegex.exec(text)) !== null) {
      const lineContent = match.groups?.content ?? '';
      const newlineSeparator = match.groups?.newline ?? '';
      const lineEndOffset = offset + lineContent.length;

      // Check if the position is within this line's content
      if (clampedPosition <= lineEndOffset) {
        const column = clampedPosition - offset + 1; // 1-based
        return { line: lineNumber, column };
      }

      // Move offset past the line content and its newline separator
      offset = lineEndOffset + newlineSeparator.length;
      lineNumber++;

      // If we've processed all text, break to avoid infinite loop
      if (newlineSeparator === '' || match.index + match[0].length >= text.length) {
        break;
      }
    }

    // Fallback for empty text or edge cases: return line 1, column 1
    return { line: 1, column: 1 };
  },
};
