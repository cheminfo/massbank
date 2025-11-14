import type { ParseError } from '../types.js';

/**
 * Utility functions for position calculations
 * Handle position/line/column calculations
 */
export const PositionUtils = {
  /**
   * Get character position from line and column (both 1-based).
   * Converts 1-based line/column to a 0-based character offset in the text.
   * @param lines - Array of lines in the text
   * @param lineIndex - Line number (1-based)
   * @param column - Column number (1-based)
   * @returns 0-based character position in the original text
   */
  getPosition(lines: string[], lineIndex: number, column: number): number {
    // Convert 1-based line/column to 0-based for internal calculation
    const zeroBasedLine = lineIndex - 1;
    const zeroBasedColumn = column - 1;

    let position = 0;
    // Sum lengths of all lines before the target line
    for (let i = 0; i < zeroBasedLine; i++) {
      const line = lines[i] ?? '';
      // Only non-last lines have a trailing newline
      position += line.length + (i < lines.length - 1 ? 1 : 0);
    }
    // Add the column offset within the target line
    position += zeroBasedColumn;
    return position;
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

    const lines = text.split(/\r?\n/);
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Only non-last lines have a trailing newline
      const lineLength = line.length + (i < lines.length - 1 ? 1 : 0);

      if (offset + lineLength > clampedPosition || i === lines.length - 1) {
        // Found the line containing this position
        const lineNumber = i + 1; // 1-based
        const column = clampedPosition - offset + 1; // 1-based
        return { line: lineNumber, column };
      }
      offset += lineLength;
    }

    // Fallback for empty text: return line 1, column 1
    return { line: 1, column: 1 };
  },
};
