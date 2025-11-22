import { describe, expect, it } from 'vitest';

import type { Record } from '../record.js';
import { UnrecognizedFieldRule } from '../validation/rules/unrecognized-field-rule.js';

describe('UnrecognizedFieldRule', () => {
  const rule = new UnrecognizedFieldRule();
  const dummyRecord: Record = { ACCESSION: 'TEST' } as Record;

  it('should not warn for recognized fields', () => {
    const text = `ACCESSION: TEST
RECORD_TITLE: Test
DATE: 2024-01-01
AUTHORS: Test Author
LICENSE: CC BY
CH$NAME: Test Compound
AC$INSTRUMENT: Test Instrument
MS$FOCUSED_ION: Test
PK$NUM_PEAK: 0
//`;

    const warnings = rule.getWarnings(dummyRecord, text, 'test.txt');

    expect(warnings).toHaveLength(0);
  });

  it('should warn for unrecognized fields', () => {
    const text = `ACCESSION: TEST
RECRD_TITLE: Test with typo
UNKNOWN_FIELD: Some value
DATE: 2024-01-01
//`;

    const warnings = rule.getWarnings(dummyRecord, text, 'test.txt');

    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toContain('RECRD_TITLE');
    expect(warnings[0]?.line).toBe(2);
    expect(warnings[1]?.message).toContain('UNKNOWN_FIELD');
    expect(warnings[1]?.line).toBe(3);
  });

  it('should not warn for comments or empty lines', () => {
    const text = `ACCESSION: TEST
// This is a comment
//
RECORD_TITLE: Test
//`;

    const warnings = rule.getWarnings(dummyRecord, text, 'test.txt');

    expect(warnings).toHaveLength(0);
  });

  it('should validate method returns empty array', () => {
    const errors = rule.validate(dummyRecord, 'test', 'test.txt');

    expect(errors).toHaveLength(0);
  });
});
