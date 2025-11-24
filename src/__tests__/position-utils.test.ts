import { describe, expect, it } from 'vitest';

import { PositionUtils } from '../parser/index.js';

describe('PositionUtils', () => {
  it('should convert line/column to position and back', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test
//`;

    const line = 2;
    const column = 'RECORD_TITLE: Test'.indexOf('T') + 1;

    const position = PositionUtils.getPosition(text, line, column);
    const { line: backLine, column: backColumn } = PositionUtils.getLineColumn(
      text,
      position,
    );

    expect(backLine).toBe(line);
    expect(backColumn).toBe(column);
  });

  it('should create parse errors with correct line and column', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Te™st
//`;

    const position = text.indexOf('™');
    const error = PositionUtils.createParseError(
      text,
      position,
      'Non-standard character',
    );

    expect(error.line).toBe(2);
    expect(error.column).toBeGreaterThan(0);

    const lines = text.split(/\r?\n/);
    const lineIndex = error.line - 1;
    const columnIndex = error.column - 1;

    expect(lines[lineIndex]?.[columnIndex]).toBe('™');
  });

  it('should handle CRLF line endings correctly', () => {
    // Text with CRLF line endings (\\r\\n)
    const text = 'ACCESSION: TEST001\r\nRECORD_TITLE: Test\r\n//';

    const line = 2;
    const column = 'RECORD_TITLE: Test'.indexOf('T') + 1;

    const position = PositionUtils.getPosition(text, line, column);
    const { line: backLine, column: backColumn } = PositionUtils.getLineColumn(
      text,
      position,
    );

    expect(backLine).toBe(line);
    expect(backColumn).toBe(column);

    // Verify the position is correct: line 1 has "ACCESSION: TEST001" (18 chars) + CRLF (2 chars) = 20
    // So line 2 starts at offset 20, and column 15 should be at position 20 + 14 = 34
    const expectedPosition = 'ACCESSION: TEST001\r\n'.length + column - 1;

    expect(position).toBe(expectedPosition);
  });

  it('should handle mixed LF and position calculations correctly', () => {
    // Text with LF line endings (\\n)
    const text = 'ACCESSION: TEST001\nRECORD_TITLE: Test\n//';

    const line = 2;
    const column = 'RECORD_TITLE: Test'.indexOf('T') + 1;

    const position = PositionUtils.getPosition(text, line, column);
    const { line: backLine, column: backColumn } = PositionUtils.getLineColumn(
      text,
      position,
    );

    expect(backLine).toBe(line);
    expect(backColumn).toBe(column);

    // Verify the position is correct: line 1 has "ACCESSION: TEST001" (18 chars) + LF (1 char) = 19
    // So line 2 starts at offset 19, and column 15 should be at position 19 + 14 = 33
    const expectedPosition = 'ACCESSION: TEST001\n'.length + column - 1;

    expect(position).toBe(expectedPosition);
  });
});
