import { describe, expect, it } from 'vitest';

import { parseRecord } from '../parser/index.js';
import type { Record } from '../record.js';
import { NonStandardCharsRule } from '../validation/rules/non-standard-chars-rule.js';

describe('NonStandardCharsRule - Position Calculations', () => {
  it('should report correct line and column for non-standard char in middle of file', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test Record
CH$NAME: Test™Compound
DATE: 2024.01.01
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings.length).toBeGreaterThan(0);

    const warning = warnings[0];

    expect(warning).toBeDefined();
    expect(warning?.line).toBe(3);
    expect(warning?.column).toBeGreaterThan(0);

    const lines = text.split(/\r?\n/);
    const lineIndex = (warning?.line ?? 1) - 1;
    const columnIndex = (warning?.column ?? 1) - 1;

    expect(lines[lineIndex]?.[columnIndex]).toBe('™');
  });

  it('should report correct line and column for non-standard char on last line', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test
//™`;

    // This text is not a valid record (terminator line contains extra data),
    // so construct a minimal record manually.
    const record: Record = {
      ACCESSION: 'TEST001',
    };
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings.length).toBeGreaterThan(0);

    const warning = warnings[0];

    expect(warning).toBeDefined();
    expect(warning?.line).toBe(3);
    expect(warning?.column).toBeGreaterThan(0);

    const lines = text.split(/\r?\n/);
    const lineIndex = (warning?.line ?? 1) - 1;
    const columnIndex = (warning?.column ?? 1) - 1;

    expect(lines[lineIndex]?.[columnIndex]).toBe('™');
  });

  it('should skip deprecated records and not report warnings', () => {
    const text = `ACCESSION: TEST001
DEPRECATED: 2024-01-01 Test
RECORD_TITLE: Test™Record
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings).toHaveLength(0);
  });

  it('should not warn on standard ASCII characters', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test-Record_123
CH$NAME: Compound-A
CH$FORMULA: C10H12N2O3
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings).toHaveLength(0);
  });

  it('should handle non-standard chars in first line correctly', () => {
    const text = `ACCESSION: TEST™001
RECORD_TITLE: Test
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings.length).toBeGreaterThan(0);

    const warning = warnings[0];

    expect(warning?.line).toBe(1);
    expect(warning?.column).toBeGreaterThan(0);

    const lines = text.split(/\r?\n/);
    const lineIndex = (warning?.line ?? 1) - 1;
    const columnIndex = (warning?.column ?? 1) - 1;

    expect(lines[lineIndex]?.[columnIndex]).toBe('™');
  });

  it('should handle allowed special characters without warning', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test [M+H]+ @25°C with µL
CH$NAME: Compound-A (99%) {structure}
CH$SMILES: C=C\\C
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings).toHaveLength(0);
  });

  it('should detect non-standard char at exact end of line before newline', () => {
    const text = `ACCESSION: TEST001
RECORD_TITLE: Test™
CH$NAME: Compound
//`;

    const record = parseRecord(text);
    const rule = new NonStandardCharsRule();
    const warnings = rule.getWarnings(record, text, 'test.txt', {});

    expect(warnings.length).toBeGreaterThan(0);

    const warning = warnings[0];

    expect(warning?.line).toBe(2);
    expect(warning?.column).toBeGreaterThan(0);

    const lines = text.split(/\r?\n/);
    const lineIndex = (warning?.line ?? 1) - 1;
    const columnIndex = (warning?.column ?? 1) - 1;

    expect(lines[lineIndex]?.[columnIndex]).toBe('™');
  });
});
