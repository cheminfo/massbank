import { describe, expect, it } from 'vitest';

import { matchFieldKey, startsNewField } from '../parser/field-line.js';

// M-1: the safety property the colon fix rests on is that startsNewField only ever
// fires on lines that actually contain a colon. If FIELD_LINE_STRICT's trailing
// colon were made optional, table rows like `TIC 100 200` would wrongly be treated
// as new fields and terminate the table early — exactly the class of bug the
// colon fix was meant to close.
describe('startsNewField (FIELD_LINE_STRICT)', () => {
  it('does not treat a capitalised line without a colon as a new field', () => {
    expect(startsNewField('TIC 100 200')).toBe(false);
  });

  it('never returns true for a line that lacks a colon', () => {
    // Property-style: for every line here without a colon, startsNewField(line)
    // must be false — the contrapositive of `startsNewField(x) ⟹ x.includes(':')`.
    const linesWithoutColon = [
      'TIC 100 200',
      '494.35 1 [lyso_PC(alkyl-18',
      'RECORD_TITLE without colon',
      'plain text',
      'PK$NUM_PEAK',
      '',
      '   ',
    ];

    for (const line of linesWithoutColon) {
      expect(startsNewField(line)).toBe(false);
    }
  });

  it('is case-sensitive: only an upper-case key ends the table', () => {
    expect(startsNewField('record_title: x')).toBe(false);
    expect(startsNewField('RECORD_TITLE: x')).toBe(true);
  });
});

describe('matchFieldKey (FIELD_LINE_ANY_CASE)', () => {
  it('extracts the field key from a well-formed field line', () => {
    expect(matchFieldKey('RECORD_TITLE: Test')).toBe('RECORD_TITLE');
  });

  it('is case-insensitive on the leading letter', () => {
    expect(matchFieldKey('record_title: Test')).toBe('record_title');
    expect(matchFieldKey('RECORD_TITLE: Test')).toBe('RECORD_TITLE');
  });

  it('returns null for a line that is not a field line', () => {
    expect(matchFieldKey('  100.0 1.0 999')).toBeNull();
    expect(matchFieldKey('TIC 100 200')).toBeNull();
  });
});
