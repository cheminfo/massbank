import { describe, expect, it } from 'vitest';

import { parseRecord } from '../../../parser/parse-record.js';
import { validateContent } from '../../../validator/validateContent.js';
import { AnnotationHeaderRule } from '../annotation-header-rule.js';

const OPTIONS = {};

function warningsFor(text: string) {
  const record = parseRecord(text);
  return new AnnotationHeaderRule().getWarnings(
    record,
    text,
    'MSBNK-test-TST00001.txt',
    OPTIONS,
  );
}

describe('AnnotationHeaderRule', () => {
  it('warns when the header names the same typed field twice', () => {
    // `mass` and `exact_mass` both mean exactMass, so the header cannot be used
    // positionally and every row falls back to a token-count guess.
    const warnings = warningsFor(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z mass exact_mass
  100.25 100.24 100.23
//
`);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(
      "PK$ANNOTATION header 'm/z mass exact_mass'",
    );
    expect(warnings[0]?.file).toBe('MSBNK-test-TST00001.txt');
    // Pointing at the header line is the whole reason a reader can act on this.
    expect(warnings[0]?.line).toBe(2);
  });

  it('warns when the header does not begin with the m/z column', () => {
    const warnings = warningsFor(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: intensity m/z
  100.25 3
//
`);

    expect(warnings).toHaveLength(1);
  });

  it('stays silent for the header every annotated corpus record uses', () => {
    const warnings = warningsFor(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z tentative_formula formula_count mass error(ppm)
  59.0134 C2H3O2- 1 59.0133 2.9
//
`);

    expect(warnings).toStrictEqual([]);
  });

  it('stays silent for a column name it has never seen', () => {
    // An unrecognised column is routed into `extra` losslessly — nothing is at
    // risk, so warning about it would be noise on a header space the grammar
    // deliberately leaves open.
    const warnings = warningsFor(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z something_novel
  100.25 whatever
//
`);

    expect(warnings).toStrictEqual([]);
  });

  it('stays silent for a record with no annotation table at all', () => {
    const warnings = warningsFor(`ACCESSION: MSBNK-test-TST00001
//
`);

    expect(warnings).toStrictEqual([]);
  });

  it('never produces a blocking error', () => {
    expect(new AnnotationHeaderRule().validate()).toStrictEqual([]);
  });

  it('is wired into the default validator, so validateContent surfaces it', async () => {
    // Every assertion above drives the rule class directly, which would stay
    // green if the rule were never registered. This is the one that fails if it
    // is dropped from RecordValidator's default set.
    const text = `ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z mass exact_mass
  100.25 100.24 100.23
//
`;

    const result = await validateContent(text, 'MSBNK-test-TST00001.txt');

    expect(
      result.warnings.filter((w) => w.message.includes('PK$ANNOTATION header')),
    ).toHaveLength(1);
  });
});
