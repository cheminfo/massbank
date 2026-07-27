import { describe, expect, it } from 'vitest';

import { parseRecord } from '../parser/parse-record.js';
import { PeakTableParser } from '../parser/table-parsers.js';
import type { InternalRecord } from '../record.js';
import { serializeRecord } from '../serializer/record-serializer.js';
import { validateContent } from '../validator/validateContent.js';

// Lipid nomenclature puts a colon inside an annotation value. Terminating the table on
// any colon truncated the table and dropped every row that followed.
const RECORD = `ACCESSION: MSBNK-Test-TST00001
RECORD_TITLE: Test; LC-ESI-QTOF; MS2
DATE: 2024.01.01
AUTHORS: Test
LICENSE: CC BY
CH$NAME: Test
CH$FORMULA: C6H12O6
CH$EXACT_MASS: 180.0634
CH$SMILES: C
CH$IUPAC: InChI=1S/CH4/h1H4
AC$INSTRUMENT: Test
AC$INSTRUMENT_TYPE: LC-ESI-QTOF
AC$MASS_SPECTROMETRY: MS_TYPE MS2
AC$MASS_SPECTROMETRY: ION_MODE POSITIVE
PK$SPLASH: splash10-0000-0000000000-0000000000000000000
PK$ANNOTATION: m/z num type mass error(ppm) formula
  494.35 1 [lyso_PC(alkyl-18:0,-)]- 494.3610499491 -21 C25H53NO6P-
  510.33 2 [lyso_PC(18:1)+H]+ 510.3554 -3 C26H53NO7P+
PK$NUM_PEAK: 2
PK$PEAK: m/z int. rel.int.
  329.24 44.5 83
  343.08 12.5 23
//
`;

// Same record, minus PK$SPLASH: the fixture's SPLASH value above is fake, so
// SplashRule would otherwise reject it. Used for the end-to-end validateContent
// regression check (M-4), which cares about acceptance, not the SPLASH rule.
const RECORD_NO_SPLASH = RECORD.replace(
  'PK$SPLASH: splash10-0000-0000000000-0000000000000000000\n',
  '',
);

describe('table parsers with colons inside values', () => {
  it('keeps every annotation row when a value contains a colon', () => {
    const record = parseRecord(RECORD);

    expect(record.PK$ANNOTATION).toHaveLength(2);
    expect(record.PK$ANNOTATION?.[0]?.mz).toBe(494.35);
    expect(record.PK$ANNOTATION?.[1]?.mz).toBe(510.33);
  });

  it('still reads the fields that follow the annotation table', () => {
    const record = parseRecord(RECORD);

    expect(record.PK$NUM_PEAK).toBe(2);
    expect(record.PK$PEAK).toHaveLength(2);
  });

  it('round-trips exactly, so SerializationRule cannot reject it', () => {
    expect(serializeRecord(parseRecord(RECORD))).toBe(RECORD);
  });
});

// M-4: end-to-end regression for the actual user-facing defect — a colon-bearing
// annotation record must be ACCEPTED by the full validator, not just survive the
// parser in isolation.
describe('validateContent with colons inside annotation values', () => {
  it('accepts a colon-bearing annotation record with no bogus warnings', async () => {
    const result = await validateContent(
      RECORD_NO_SPLASH,
      'MSBNK-Test-TST00001.txt',
    );

    expect(result.success).toBe(true);
    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });
});

describe('PeakTableParser with a malformed non-numeric row', () => {
  it('does not treat a stray colon line as ending the table early', () => {
    const record: InternalRecord = { ACCESSION: '' };
    const lines = [
      '  100.0 1.0 999',
      '  junk:x', // lowercase on purpose: a mis-cased key must NOT terminate the table
      '  200.0 2.0 999',
      'PK$NUM_PEAK: 2',
    ];

    new PeakTableParser().parse('PK$PEAK', lines, 0, record);

    expect(record.PK$PEAK).toHaveLength(2); // 1 without the fix
  });
});
