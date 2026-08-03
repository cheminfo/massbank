import { describe, expect, it } from 'vitest';

import { buildRecord } from '../../builder/build-record.ts';
import { validateRecord } from '../../builder/validate-record.ts';
import { serializeRecord } from '../../serializer/record-serializer.ts';
import { validateContent } from '../../validator/validateContent.ts';

const built = () =>
  buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    RECORD_TITLE: 'Caffeine; LC-ESI-QFT; MS2',
    DATE: '2026.07.29',
    AUTHORS: 'Doe J',
    LICENSE: 'CC BY',
    CH$NAME: ['Caffeine'],
    CH$FORMULA: 'C8H10N4O2',
    CH$EXACT_MASS: '194.0804',
    CH$SMILES: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
    CH$IUPAC: 'InChI=1S/C8H10N4O2',
    AC$INSTRUMENT: 'Thermo Q Exactive',
    AC$INSTRUMENT_TYPE: 'LC-ESI-QFT',
    AC$MASS_SPECTROMETRY: ['MS_TYPE MS2', 'ION_MODE POSITIVE'],
    PK$PEAK: [
      { mz: 300.5, intensity: 10, relativeIntensity: 100 },
      { mz: 100.25, intensity: 100, relativeIntensity: 999 },
    ],
  });

describe('validateRecord', () => {
  it('accepts a record produced by buildRecord', async () => {
    const result = await validateRecord(await built());

    expect(result.errors).toStrictEqual([]);
    expect(result.success).toBe(true);
  });

  it('reports the accession it validated', async () => {
    const result = await validateRecord(await built());

    expect(result.accessions).toContain('MSBNK-test-TST00001');
  });

  it('detects a defect genuinely in the text', async () => {
    // Proves the delegation is real and not a stub returning success.
    const record = await built();
    record.PK$SPLASH = 'splash10-0000-0000000000-0000000000000000000000000000';
    const result = await validateRecord(record);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.type === 'splash')).toBe(true);
  });

  // The options pass-through cannot be guarded behaviorally: no rule reads
  // ValidationOptions.legacy, and `legacy` only ever loosens rules — so a valid
  // fixture stays valid either way. Re-add a real test when a legacy-sensitive
  // rule exists.

  it('accepts a record containing only ACCESSION, per the docstring contract', async () => {
    // Pins the docstring's claim that mandatory fields and CVs are NOT checked.
    // This must fail the day a mandatory-field rule lands AS AN ERROR — that is
    // exactly when the docstring needs rewriting. A warnings-only rule leaves
    // `success` true and would not catch it.
    const record = await buildRecord({ ACCESSION: 'MSBNK-test-TST00001' });
    const result = await validateRecord(record);

    expect(result.success).toBe(true);
  });

  it('cannot fail the accession check, and the rule is alive elsewhere', async () => {
    // Differential: the rule is unreachable through validateRecord, but must
    // still fire through validateContent with a real filename. Match on the
    // message prefix, not the word "filename": the text reads "ACCESSION
    // mismatch: File is named …" and never contains that word, so a substring
    // check on it would pass whether or not the rule fired.
    const record = await built();
    record.ACCESSION = 'MSBNK-other-XYZ99999';

    const viaRecord = await validateRecord(record);

    expect(viaRecord.errors).toStrictEqual([]);

    const viaText = await validateContent(
      serializeRecord(record),
      'MSBNK-test-TST00001.txt',
    );

    expect(
      viaText.errors.some((e) => e.message.startsWith('ACCESSION mismatch')),
    ).toBe(true);
  });
});
