import { describe, expect, it } from 'vitest';

import { PositionUtils } from '../parser/index.js';

describe('PositionUtils', () => {
  it('should convert line/column to position and back', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test
//`;
    const lines = text.split(/\r?\n/);

    const line = 2;
    const column = 'RECORD_TITLE: Test'.indexOf('T') + 1;

    const position = PositionUtils.getPosition(lines, line, column);
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
});
