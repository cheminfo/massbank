import { describe, expect, it } from 'vitest';

import { validateContent } from '../validator/validateContent.js';

// K-1: the Java's allowed-character class includes \n but omits \r, so it warns on every
// CRLF record. That is a bug in the original and is deliberately NOT mirrored. This test
// exists so the deliberate divergence cannot be silently undone.
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
PK$NUM_PEAK: 2
PK$PEAK: m/z int. rel.int.
  329.24 44.5 83
  343.08 12.5 23
//
`;

describe('CRLF handling (K-1)', () => {
  it('does not warn about non-standard characters for CRLF line endings', async () => {
    const crlf = RECORD.replaceAll('\n', '\r\n');
    const result = await validateContent(crlf, 'MSBNK-Test-TST00001.txt');

    // `warnings` is also `[]` when the parse fails outright, so assert the parse
    // actually succeeded before relying on the absence of the warning.
    expect(result.success).toBe(true);
    expect(
      result.warnings.filter((w) => /non[- ]standard/i.test(w.message)),
    ).toHaveLength(0);
  });

  it('treats LF and CRLF as equivalent', async () => {
    const lf = await validateContent(RECORD, 'MSBNK-Test-TST00001.txt');
    const crlf = await validateContent(
      RECORD.replaceAll('\n', '\r\n'),
      'MSBNK-Test-TST00001.txt',
    );

    expect(lf.success).toBe(true);
    expect(crlf.success).toBe(lf.success);
    expect(crlf.errors.map((e) => e.type)).toStrictEqual(
      lf.errors.map((e) => e.type),
    );
    expect(crlf.warnings).toStrictEqual(lf.warnings);
  });
});
