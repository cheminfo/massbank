import type { ParseError } from '../types.js';

/**
 * Utility functions for position calculations
 * Single Responsibility: Handle position/line/column calculations
 */
export const PositionUtils = {
  /**
   * Get character position from line and column
   * @param lines
   * @param lineIndex
   * @param column
   */
  getPosition(
    lines: string[],
    lineIndex: number,
    column: number,
  ): number {
    let position = 0;
    for (let i = 0; i < lineIndex; i++) {
      position += lines[i]!.length + 1; // +1 for newline
    }
    position += column;
    return position;
  },

  /**
   * Create a ParseError from position
   * @param text
   * @param position
   * @param message
   */
  createParseError(
    text: string,
    position: number,
    message: string,
  ): ParseError {
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

    return {
      position,
      message,
      line: lineNumber,
      column,
    };
  },

  /**
   * Get line and column from position
   * @param text
   * @param position
   */
  getLineColumn(
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
  },
};
