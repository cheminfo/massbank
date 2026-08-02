import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VERBATIM_ARRAY_FIELDS,
  VERBATIM_STRING_FIELDS,
  buildRecord,
} from '../../builder/build-record.ts';
import { BuildException } from '../../builder/exceptions.ts';
import { validateRecord } from '../../builder/validate-record.ts';
import { parseRecord } from '../../parser/parse-record.ts';
import type {
  Annotation,
  AnnotationWithOriginal,
  MassBankRecord,
  Peak,
} from '../../record.ts';
import { serializeRecord } from '../../serializer/record-serializer.ts';
import { calculateSplash } from '../../splash/calculate-splash.ts';

const minimal = () => ({
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
});

const unsorted = () => [
  { mz: 300.5, intensity: 10, relativeIntensity: 100 },
  { mz: 100.25, intensity: 100, relativeIntensity: 999 },
  { mz: 200, intensity: 50, relativeIntensity: 500 },
];

// A row parsed from a real PK$ANNOTATION table with more than 4 columns —
// the parser keeps only mz and the second token as `annotation`, stashing
// the rest of the source line in `_original` (table-parsers.ts).
const fiveColumnRecord = () =>
  parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z tentative_formula formula_count exact_mass error(ppm)
  59.0134 C2H3O2- 1 59.0133 2.9
//
`);

/**
 * The first element of a non-empty array, or throw. A plain `array[0]!` would
 * silence `noUncheckedIndexedAccess` rather than prove the array is
 * non-empty; a helper (rather than a conditional inline in a test body) is
 * also what `vitest/no-conditional-in-test` requires.
 * @param array - the array to read from
 * @returns the first element
 */
function firstOf<T>(array: readonly T[]): T {
  const [first] = array;
  if (first === undefined) {
    throw new Error('expected at least one element');
  }
  return first;
}

/**
 * Drop `_original` from each row so a reparsed table can be compared against
 * a caller-built one. A text-only round-trip check (`serializeRecord(parseRecord(x))
 * === x`) is a fixed point of ANY consistent relabelling of the positional
 * columns — swapping which field a serializer writes first passes it just as
 * well as the correct order. Comparing the reparsed OBJECT is what actually
 * proves the data landed in the right fields.
 * @param rows - the parsed rows to strip
 * @returns the rows with `_original` removed, in the same order
 */
function stripOriginal<T extends { _original?: unknown }>(
  rows: T[] | undefined,
): Array<Omit<T, '_original'>> {
  return (rows ?? []).map(({ _original, ...rest }) => rest);
}

/**
 * Normalise a record for a whole-record comparison across a build round
 * trip. Omits exactly what `buildRecord` intentionally recomputes or
 * replaces rather than preserves — `PK$SPLASH` (recomputed from the peaks)
 * and `PK$NUM_PEAK` (derived from the peak count) — and strips `_original`
 * from every peak row (see `stripOriginal`): a peak is ALWAYS rebuilt from
 * its numeric fields (never preserved verbatim), so its reparsed
 * `_original` reflects `Number.prototype.toString()`'s formatting of the
 * canonicalised value (e.g. `100.2500` becomes `100.25`), not the fixture's
 * original source text — comparing it would be a false failure, not a real
 * check.
 *
 * `_PK$ANNOTATION_HEADER` and `PK$ANNOTATION` (including each row's
 * `_original`) are deliberately NOT stripped, unlike peaks: every fixture
 * this comparison runs against is round-tripped with no edits
 * (`buildRecord(parsed)`, never a caller-modified draft — see the `it.each`
 * loop below), so any annotation table present is always preserved
 * verbatim (`preserveOriginals`, build-record.ts), meaning the reparsed
 * `_original` and header are expected to equal the fixture's own — a
 * mismatch here is a real defect, not a formatting difference. Comparing
 * them verbatim (rather than stripping, as an earlier version of this
 * helper did) is what makes this loop able to catch a header that silently
 * fell back to buildRecord's canonical default, or an `_original` silently
 * truncated or reformatted instead of preserved — a whole-object
 * `stripOriginal` comparison could not tell either apart from success.
 * Every other field must match exactly too, or `buildRecord` silently
 * dropped or mangled something it has no business touching.
 * @param record - the record to normalise
 * @returns the record with the recomputed peak fields omitted and each
 * peak's `_original` stripped
 */
function normalizeForComparison(record: MassBankRecord) {
  const { PK$SPLASH, PK$NUM_PEAK, PK$PEAK, ...rest } = record;

  return {
    ...rest,
    PK$PEAK: stripOriginal(PK$PEAK),
  };
}

/**
 * Rebuild an annotation row's own source text from its typed fields alone,
 * mirroring the shape buildRecord prints for a row whose `_original` is
 * discarded — reimplemented independently here (not imported from
 * build-record.ts) so a comparison against it is a real proof, not a
 * reflection of the code under test.
 * @param row - the annotation row to rebuild
 * @returns the whitespace-joined rebuilt row text
 */
function naiveRebuildAnnotationText(row: Annotation): string {
  const parts = [String(row.mz)];
  if (row.annotation !== undefined) {
    parts.push(row.annotation);
  }
  if (row.exactMass !== undefined) {
    parts.push(String(row.exactMass));
  }
  if (row.errorPpm !== undefined) {
    parts.push(String(row.errorPpm));
  }
  return parts.join(' ');
}

/**
 * Parse a single PK$ANNOTATION row's source text through the real parser.
 * @param text - the row's source text
 * @returns what the parser produces from `text` today, or `undefined` if it
 * drops the line entirely
 */
function parseAnnotationText(text: string): AnnotationWithOriginal | undefined {
  return parseRecord(`ACCESSION: sweep\nPK$ANNOTATION: m/z\n  ${text}\n//\n`)
    .PK$ANNOTATION?.[0];
}

/**
 * Compare only the fields the parser can produce.
 * @param a - a row's fields
 * @param b - another row's fields, or `undefined` if there is none
 * @returns true when every field matches exactly
 */
function annotationFieldsMatch(
  a: Annotation,
  b: Annotation | undefined,
): boolean {
  return (
    b !== undefined &&
    a.mz === b.mz &&
    a.annotation === b.annotation &&
    a.exactMass === b.exactMass &&
    a.errorPpm === b.errorPpm
  );
}

/**
 * Whether rebuilding `row` from its typed fields alone and reparsing the
 * result through the real parser reproduces `row` itself — the independent
 * oracle the property sweeps below classify against, so a disagreement means
 * buildRecord and the live parser have drifted apart, not that this file's
 * own expectations were wrong.
 * @param row - the row to classify
 * @returns true when rebuilding `row` would round-trip losslessly
 */
function wouldRoundTripIfRebuilt(row: Annotation): boolean {
  return annotationFieldsMatch(
    row,
    parseAnnotationText(naiveRebuildAnnotationText(row)),
  );
}

/**
 * Whether every numeric field the parser mapped from a row is finite —
 * independent of buildRecord's own `checkAnnotationFiniteValues`, so
 * classifying against it is a real check, not a reflection of the code
 * under test. For a row sourced from real parsing, this is the only way it
 * can be unrepresentable: `annotation` is always a single safe token when it
 * comes from real parsing, so it is never empty, whitespace-only, or
 * internally spaced.
 * @param row - the row to classify
 * @returns true when `mz`, `exactMass`, and `errorPpm` are all finite
 */
function isRepresentable(row: Annotation): boolean {
  return (
    Number.isFinite(row.mz) &&
    (row.exactMass === undefined || Number.isFinite(row.exactMass)) &&
    (row.errorPpm === undefined || Number.isFinite(row.errorPpm))
  );
}

describe('buildRecord normalises what validation cannot detect', () => {
  it('sorts peaks ascending by m/z', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });

    expect(record.PK$PEAK?.map((p) => p.mz)).toStrictEqual([
      100.25, 200, 300.5,
    ]);
  });

  it('keeps each m/z paired with its own intensity when sorting', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });

    expect(record.PK$PEAK?.map((p) => [p.mz, p.intensity])).toStrictEqual([
      [100.25, 100],
      [200, 50],
      [300.5, 10],
    ]);
  });

  it('derives PK$NUM_PEAK, overriding a wrong one', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$NUM_PEAK: 99,
      PK$PEAK: unsorted(),
    });

    expect(record.PK$NUM_PEAK).toBe(3);
  });

  it('recomputes PK$SPLASH over a declared one', async () => {
    const stale = 'splash10-0000-0000000000-0000000000000000000000000000';
    const record = await buildRecord({
      ...minimal(),
      PK$SPLASH: stale,
      PK$PEAK: unsorted(),
    });

    expect(record.PK$SPLASH).toMatch(/^splash10-/);
    expect(record.PK$SPLASH).not.toBe(stale);
  });

  it('drops PK$NUM_PEAK when there are no peaks', async () => {
    // Otherwise a count survives with no table — a defect validateContent accepts.
    const record = await buildRecord({
      ...minimal(),
      PK$NUM_PEAK: 99,
      PK$SPLASH: 'splash10-0000-0000000000-0000000000000000000000000000',
    });

    expect(record.PK$NUM_PEAK).toBeUndefined();
    expect(record.PK$PEAK).toBeUndefined();
    expect(record.PK$SPLASH).toBeUndefined();
  });

  it('drops an empty annotation table', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [],
      PK$PEAK: unsorted(),
    });

    expect(record.PK$ANNOTATION).toBeUndefined();
  });

  it('sorts annotations ascending', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 200 }, { mz: 100.25 }],
      PK$PEAK: unsorted(),
    });

    expect(record.PK$ANNOTATION?.map((a) => a.mz)).toStrictEqual([100.25, 200]);
  });

  it('does not mutate its input', async () => {
    const peaks = unsorted();
    const draft = { ...minimal(), PK$PEAK: peaks, PK$NUM_PEAK: 99 };
    await buildRecord(draft);

    expect(peaks.map((p) => p.mz)).toStrictEqual([300.5, 100.25, 200]);
    expect(draft.PK$NUM_PEAK).toBe(99);
  });

  it('does not mutate the input annotation array', async () => {
    const annotations = [{ mz: 200 }, { mz: 100.25 }];
    const draft = { ...minimal(), PK$ANNOTATION: annotations };
    await buildRecord(draft);

    expect(annotations.map((a) => a.mz)).toStrictEqual([200, 100.25]);
  });

  it('strips _original so the serializer cannot print stale text', async () => {
    // serializeRecord PREFERS _original, while PK$SPLASH and PK$NUM_PEAK
    // derive from the numeric fields. Without the strip, a record parsed,
    // edited and rebuilt emits a SPLASH that does not match its printed rows.
    const parsed = parseRecord(
      serializeRecord(await buildRecord({ ...minimal(), PK$PEAK: unsorted() })),
    );
    const edited =
      parsed.PK$PEAK?.map((p) => ({ ...p, mz: p.mz + 0.001 })) ?? [];
    const rebuilt = await buildRecord({ ...minimal(), PK$PEAK: edited });

    expect(rebuilt.PK$PEAK?.every((p) => !('_original' in p))).toBe(true);
    expect(serializeRecord(rebuilt)).toContain('100.251');
  });

  it('strips _original from annotations so the serializer cannot print stale text', async () => {
    // Mirrors the peak _original test: record-serializer.ts:134 PREFERS
    // ann._original exactly as it prefers a peak's, so the same corruption is
    // possible on this path — a rebuilt annotation must not carry it forward.
    const parsed = parseRecord(
      serializeRecord(
        await buildRecord({
          ...minimal(),
          PK$PEAK: unsorted(),
          PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
        }),
      ),
    );
    const edited =
      parsed.PK$ANNOTATION?.map((a) => ({ ...a, mz: a.mz + 0.001 })) ?? [];
    const rebuilt = await buildRecord({
      ...minimal(),
      PK$PEAK: unsorted(),
      PK$ANNOTATION: edited,
    });

    expect(rebuilt.PK$ANNOTATION?.every((a) => !('_original' in a))).toBe(true);
    expect(serializeRecord(rebuilt)).toContain('100.251');
  });

  it('preserves duplicate m/z', async () => {
    // Duplicates are legal: dropping loses data, summing invents it.
    const record = await buildRecord({
      ...minimal(),
      PK$PEAK: [
        { mz: 100.25, intensity: 100, relativeIntensity: 999 },
        { mz: 100.25, intensity: 50, relativeIntensity: 500 },
      ],
    });

    expect(record.PK$PEAK?.map((p) => [p.mz, p.intensity])).toStrictEqual([
      [100.25, 100],
      [100.25, 50],
    ]);
    expect(record.PK$NUM_PEAK).toBe(2);
  });

  it('throws BuildException, not RangeError, on a spectrum that cannot be hashed', async () => {
    // Folded in from calculateSplash's own RangeError: SplashRule swallows
    // that error on the validation side ("skip rather than crash"), but
    // buildRecord refuses to publish a record with no PK$SPLASH, and now
    // reports it as an ordinary BuildError like every other guard rather
    // than as a second exception type from the same entry point.
    let caught: unknown;
    try {
      await buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: 0, relativeIntensity: 0 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);
    expect((caught as BuildException).buildErrors).toStrictEqual([
      expect.objectContaining({ code: 'PEAK_ALL_ZERO_INTENSITY' }),
    ]);
  });

  it('keeps _PK$ANNOTATION_HEADER when the annotation table round-trips unedited', async () => {
    // RecordDraft's Omit only blocks object literals — a caller can still
    // pass a parsed MassBankRecord through. When none of its rows have been
    // edited since parsing, they print as their own source text, so the
    // header they were written under is still the right one to keep.
    const parsed = parseRecord(
      serializeRecord(
        await buildRecord({
          ...minimal(),
          PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
        }),
      ),
    );

    expect(parsed._PK$ANNOTATION_HEADER).toBeDefined();

    const rebuilt = await buildRecord(parsed);

    expect(rebuilt._PK$ANNOTATION_HEADER).toBe(parsed._PK$ANNOTATION_HEADER);
  });

  it('drops a stale _PK$ANNOTATION_HEADER once a row has been edited', async () => {
    // Editing a row forces every row in the table to be rebuilt from typed
    // fields (all-or-nothing, see buildRecord), so the old header — written
    // for the old rows — must not outlive the rebuild.
    const parsed = parseRecord(
      serializeRecord(
        await buildRecord({
          ...minimal(),
          PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
        }),
      ),
    );

    expect(parsed._PK$ANNOTATION_HEADER).toBeDefined();

    const edited = (parsed.PK$ANNOTATION ?? []).map((a) => ({
      ...a,
      mz: a.mz + 0.001,
    }));
    const rebuilt = await buildRecord({ ...parsed, PK$ANNOTATION: edited });

    expect(rebuilt._PK$ANNOTATION_HEADER).toBeUndefined();
  });
});

describe('buildRecord preserves a PK$ANNOTATION table per-row, not per-table-by-fiat', () => {
  // Every test above this point uses a single-row table, where "no row was
  // edited" and "the one row was not edited" are indistinguishable. These
  // cover the table-wide all-or-nothing rule directly against a multi-row
  // table, and the edit-detection predicate against fields other than mz.

  it('discards every row _original once any row in the table is edited, even an untouched one', async () => {
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z tentative_formula formula_count exact_mass error(ppm)
  59.0134 C2H3O2- 1 59.0133 2.9
  100.25 C5H4O2- 1 100.24 1.5
//
`);
    // Only the FIRST row is edited; the second is left completely untouched.
    const edited = (parsed.PK$ANNOTATION ?? []).map((a, index) =>
      index === 0 ? { ...a, mz: a.mz + 0.001 } : a,
    );
    const draft = { ...parsed, PK$ANNOTATION: edited };

    // Both rows have 5 columns, so once table-wide preservation is dropped,
    // the untouched row (index 1) is ALSO run through
    // checkAnnotationDiscardedColumns and refused — proving it was rebuilt
    // and re-checked, not silently preserved because only the OTHER row
    // changed.
    await expect(buildRecord(draft)).rejects.toThrow(BuildException);
    await expect(buildRecord(draft)).rejects.toThrow(
      /row 1 \(mz 100\.25\).*5 columns/,
    );
  });

  it.each([
    [
      'annotation',
      (a: AnnotationWithOriginal) => ({ ...a, annotation: 'changed' }),
    ],
    [
      'exactMass',
      (a: AnnotationWithOriginal) => ({
        ...a,
        exactMass: (a.exactMass ?? 0) + 1,
      }),
    ],
    [
      'errorPpm',
      (a: AnnotationWithOriginal) => ({
        ...a,
        errorPpm: (a.errorPpm ?? 0) + 1,
      }),
    ],
  ] as const)(
    'drops _original when only %s is edited',
    async (_field, edit) => {
      const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation exact_mass error(ppm)
  100.25 fragment 100.24 1.5
//
`);
      const row = (parsed.PK$ANNOTATION ?? [])[0];

      expect(row).toBeDefined();
      // Guard against a future fixture edit silently changing this row's shape
      // out from under the sweep — every case above must edit a field this
      // row actually has, or the "edit" is a no-op and the test proves nothing.
      expect(row).toStrictEqual({
        mz: 100.25,
        annotation: 'fragment',
        exactMass: 100.24,
        errorPpm: 1.5,
        _original: '100.25 fragment 100.24 1.5',
      });

      const edited = row === undefined ? [] : [edit(row)];
      const rebuilt = await buildRecord({ ...parsed, PK$ANNOTATION: edited });

      expect(rebuilt.PK$ANNOTATION?.[0]).not.toHaveProperty('_original');
    },
  );

  it('sorts a preserved multi-row table while keeping each _original with its own row', async () => {
    // Rows print in mz order (buildRecord sorts every table), so a fixture
    // deliberately out of source order proves _original travels WITH its
    // row through that sort rather than being reprinted in source order or
    // reassigned to the wrong row.
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation
  200 second
  100.25 first
//
`);

    const record = await buildRecord(parsed);

    expect(record.PK$ANNOTATION?.map((a) => a.mz)).toStrictEqual([100.25, 200]);
    expect(record.PK$ANNOTATION?.map((a) => a._original)).toStrictEqual([
      '100.25 first',
      '200 second',
    ]);
  });
});

describe('buildRecord treats an annotation table with no _original anywhere as nothing to preserve', () => {
  // A hand-built PK$ANNOTATION array (an editor UI replacing the array
  // outright, say) has no row with an `_original` at all.
  // wasAnnotationRowEdited reports `edited: false` for every such row —
  // there is nothing to compare a fresh row against — so the OLD
  // `!annotations.some(edited)` predicate treated this as "unanimously
  // unedited" and wrongly kept whatever `_PK$ANNOTATION_HEADER` the draft
  // happened to carry over from an unrelated prior record.

  it('drops a stale _PK$ANNOTATION_HEADER when every row is hand-built (no row has _original)', async () => {
    const stale = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z tentative_formula formula_count mass error(ppm)
  59.0134 C2H3O2- 1 59.0133 2.9
//
`);

    // A draft carrying the OLD record's 5-column header alongside a fresh,
    // fully hand-built (no _original anywhere) row array — the shape an
    // editor UI produces when it replaces PK$ANNOTATION but starts from a
    // draft object that still has the old header attached.
    const draft = {
      ...stale,
      PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
    };

    const record = await buildRecord(draft);

    expect(record._PK$ANNOTATION_HEADER).toBeUndefined();
    // The rebuilt row must be printed under the DEFAULT header, not the
    // stale 5-column one — a 5-column header over this 2-token row would
    // misassign every column downstream (formula_count/mass/error(ppm) all
    // shift by one silently) with no BuildError to catch it.
    expect(serializeRecord(record)).toContain(
      'PK$ANNOTATION: m/z annotation exact_mass error(ppm)',
    );
  });
});

describe('buildRecord guards PK$ANNOTATION _original against line injection', () => {
  // _original is written verbatim into the output whenever a table
  // round-trips unedited (preserveOriginals) — a newline in it would print
  // as extra physical lines the reparser reads back as forged annotation
  // rows or forged header fields; a value that otherwise defeats a safe
  // reparse (a single line the parser reads as a real header field with an
  // invalid value) must not crash buildRecord either. RecordDraft's Omit
  // only blocks object-literal excess-property checking, not a variable of
  // the wider `AnnotationWithOriginal` type — exactly how a caller
  // legitimately carries a parsed row through, and exactly how these tests
  // construct the attack.

  it('rejects an _original containing a newline, rather than printing forged rows', async () => {
    const poisoned: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: '100.25 frag\n  999.99 FORGED 1 999.98 0.1',
    };

    await expect(
      buildRecord({ ...minimal(), PK$ANNOTATION: [poisoned] }),
    ).rejects.toThrow(BuildException);
    await expect(
      buildRecord({ ...minimal(), PK$ANNOTATION: [poisoned] }),
    ).rejects.toThrow(/newline or carriage return/);
  });

  it('rejects an _original containing a carriage return', async () => {
    const poisoned: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: '100.25 frag\r  999.99 FORGED 1 999.98 0.1',
    };

    await expect(
      buildRecord({ ...minimal(), PK$ANNOTATION: [poisoned] }),
    ).rejects.toThrow(BuildException);
  });

  it('does not let a poisoned _original abort validation before other errors are collected', async () => {
    // Before this guard, reparsing this _original threw a raw ParseException
    // out of buildRecord, which aborted the whole function before the
    // already-collected ACCESSION_EMPTY error ever reached a BuildException.
    const poisoned: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: '100.25 frag\n  PK$NUM_PEAK: notanumber',
    };

    let caught: unknown;
    try {
      await buildRecord({
        ACCESSION: '',
        PK$ANNOTATION: [poisoned],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const codes = (caught as BuildException).buildErrors.map((e) => e.code);

    expect(codes).toContain('ACCESSION_EMPTY');
  });

  it('reports a BuildError, rather than letting a raw parse exception escape, when a single-line _original reparses as a real field with an invalid value', async () => {
    // No newline at all: table-parsers.ts's startsNewField ends the mini
    // annotation table early on a line that looks like "KEY: value" for a
    // real header key, and PeakFieldParser throws on a non-numeric
    // PK$NUM_PEAK — a raw ParseException that must not escape buildRecord.
    const poisoned: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: 'PK$NUM_PEAK: notanumber',
    };

    let caught: unknown;
    try {
      await buildRecord({ ...minimal(), PK$ANNOTATION: [poisoned] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const codes = (caught as BuildException).buildErrors.map((e) => e.code);

    expect(codes).toContain('ANNOTATION_ORIGINAL_UNREADABLE');
  });
});

describe('buildRecord guards a preserved _PK$ANNOTATION_HEADER against line injection', () => {
  // _PK$ANNOTATION_HEADER is written verbatim (record-serializer.ts:130)
  // ONLY when the table's rows are being preserved — RecordDraft's Omit
  // drops this key from the type entirely (see the module comment on
  // RecordDraft), so it can't join the generic VERBATIM_STRING_FIELDS sweep
  // and needs this dedicated guard instead.

  it('rejects a preserved _PK$ANNOTATION_HEADER containing a newline', async () => {
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation
  100.25 fragment
//
`);
    // Smuggled through a variable of the wider MassBankRecord type, exactly
    // as RecordDraft's own module comment describes — draft[field] can't
    // reach this key through RecordDraft's type at all (see
    // readAnnotationHeader), so this is the only way a caller can even
    // present this value to buildRecord.
    const poisoned: MassBankRecord = {
      ...parsed,
      _PK$ANNOTATION_HEADER: 'm/z annotation\nLICENSE: forged',
    };

    await expect(buildRecord(poisoned)).rejects.toThrow(BuildException);
    await expect(buildRecord(poisoned)).rejects.toThrow(
      /_PK\$ANNOTATION_HEADER/,
    );
  });

  it('does not reject a header when the table is not being preserved (edited rows drop it anyway)', async () => {
    // A poisoned header attached to a table that is about to be rebuilt
    // (not preserved) is never written, so it must not be validated either
    // — validating it here would reject drafts that could never actually
    // produce the injection.
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation
  100.25 fragment
//
`);
    const edited = (parsed.PK$ANNOTATION ?? []).map((a) => ({
      ...a,
      mz: a.mz + 0.001,
    }));
    const draft: MassBankRecord = {
      ...parsed,
      PK$ANNOTATION: edited,
      _PK$ANNOTATION_HEADER: 'm/z annotation\nLICENSE: forged',
    };

    const record = await buildRecord(draft);

    expect(record._PK$ANNOTATION_HEADER).toBeUndefined();
  });
});

describe('buildRecord rejects an unsafe relativeIntensity', () => {
  // relativeIntensity never reaches calculateSplash (SplashPeak is
  // {mz, intensity} only), so it is the one numeric peak field that would
  // otherwise pass through unchecked.

  it('throws when relativeIntensity is NaN', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: 100.25, intensity: 100, relativeIntensity: Number.NaN },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when relativeIntensity is Infinity', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          {
            mz: 100.25,
            intensity: 100,
            relativeIntensity: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when relativeIntensity is negative', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: 100, relativeIntensity: -1 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('names the offending row in the error message', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: 100.25, intensity: 100, relativeIntensity: 999 },
          { mz: 205.5, intensity: 50, relativeIntensity: -1 },
        ],
      }),
    ).rejects.toThrow(/205\.5/);
  });

  it('accepts zero', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$PEAK: [{ mz: 100.25, intensity: 100, relativeIntensity: 0 }],
    });

    expect(record.PK$PEAK?.[0]?.relativeIntensity).toBe(0);
  });
});

describe('buildRecord rejects a peak mz that would forge a SPLASH', () => {
  // calculate-splash.ts rejects a non-finite mz but not a negative one:
  // calculateHistogram bins by `Math.trunc(mz / binSize) % HISTOGRAM_BINS`,
  // and Math.trunc(-50 / 5) === -0, aliasing a real peak at mz = -50 onto the
  // same bin as one at mz = 0..4. A negative mz cannot be left to that guard
  // to catch, since it does not.

  it('throws when the only peak has a negative mz', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: -50, intensity: 1000, relativeIntensity: 999 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when a negative mz peak is mixed with a positive one', async () => {
    // Measured: a stray negative mz forged splash10-0udi-9000000000-... with
    // zero validation errors before this guard existed, because
    // calculateSplash's own finiteness check has no opinion on sign.
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: -50, intensity: 1000, relativeIntensity: 999 },
          { mz: 200, intensity: 100, relativeIntensity: 100 },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('names the offending row in the error message', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: 100.25, intensity: 100, relativeIntensity: 999 },
          { mz: -205.5, intensity: 50, relativeIntensity: 100 },
        ],
      }),
    ).rejects.toThrow(/205\.5/);
  });

  it('accepts a zero mz', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$PEAK: [{ mz: 0, intensity: 1000, relativeIntensity: 999 }],
    });

    expect(record.PK$PEAK?.[0]?.mz).toBe(0);
  });

  it('does not reject a negative annotation mz', async () => {
    // Unlike a peak's mz, an annotation's mz never reaches calculateSplash,
    // and "-50" parses back to -50 exactly (Number.parseFloat has no
    // trouble with a leading sign), so there is no forged-hash risk and no
    // round-trip risk to guard against here — measured, not assumed.
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: -50, annotation: 'fragment' }],
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(record.PK$ANNOTATION?.[0]?.mz).toBe(-50);
    expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
      record.PK$ANNOTATION,
    );
  });
});

describe("buildRecord folds calculateSplash's peak-hashability checks into BuildException", () => {
  // Before this guard existed, a non-finite/negative intensity, a non-finite
  // mz, or an all-zero-intensity spectrum reached calculateSplash unguarded
  // and surfaced as a bare RangeError — a second exception type from the same
  // buildRecord call, alongside BuildException. These guards report the
  // identical conditions as ordinary BuildErrors instead.

  it('throws PEAK_MZ_NOT_FINITE when mz is NaN', async () => {
    let caught: unknown;
    try {
      await buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: Number.NaN, intensity: 100, relativeIntensity: 999 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);
    expect((caught as BuildException).buildErrors).toStrictEqual([
      expect.objectContaining({
        code: 'PEAK_MZ_NOT_FINITE',
        fieldName: 'PK$PEAK',
        rowIndex: 0,
        property: 'mz',
        field: 'PK$PEAK[0].mz',
      }),
    ]);
  });

  it('throws PEAK_MZ_NOT_FINITE when mz is Infinity', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [
          {
            mz: Number.POSITIVE_INFINITY,
            intensity: 100,
            relativeIntensity: 999,
          },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws PEAK_INTENSITY_NOT_FINITE when intensity is NaN', async () => {
    let caught: unknown;
    try {
      await buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: 100.25, intensity: Number.NaN, relativeIntensity: 999 },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);
    expect((caught as BuildException).buildErrors).toStrictEqual([
      expect.objectContaining({
        code: 'PEAK_INTENSITY_NOT_FINITE',
        fieldName: 'PK$PEAK',
        rowIndex: 0,
        property: 'intensity',
        field: 'PK$PEAK[0].intensity',
      }),
    ]);
  });

  it('throws PEAK_INTENSITY_NEGATIVE when intensity is negative', async () => {
    let caught: unknown;
    try {
      await buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: -1, relativeIntensity: 999 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);
    expect((caught as BuildException).buildErrors).toStrictEqual([
      expect.objectContaining({
        code: 'PEAK_INTENSITY_NEGATIVE',
        fieldName: 'PK$PEAK',
        rowIndex: 0,
        property: 'intensity',
        field: 'PK$PEAK[0].intensity',
      }),
    ]);
  });

  it('throws PEAK_ALL_ZERO_INTENSITY with no rowIndex or property — it is a fact about the whole table', async () => {
    let caught: unknown;
    try {
      await buildRecord({
        ...minimal(),
        PK$PEAK: [
          { mz: 100.25, intensity: 0, relativeIntensity: 0 },
          { mz: 200, intensity: 0, relativeIntensity: 0 },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const { buildErrors } = caught as BuildException;

    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0]).toMatchObject({
      code: 'PEAK_ALL_ZERO_INTENSITY',
      fieldName: 'PK$PEAK',
    });
    expect(buildErrors[0]).not.toHaveProperty('rowIndex');
    expect(buildErrors[0]).not.toHaveProperty('property');
  });

  it('does not throw PEAK_ALL_ZERO_INTENSITY when only one of several peaks is zero', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$PEAK: [
        { mz: 100.25, intensity: 0, relativeIntensity: 0 },
        { mz: 200, intensity: 100, relativeIntensity: 999 },
      ],
    });

    expect(record.PK$SPLASH).toMatch(/^splash10-/);
  });
});

describe("property: buildRecord's peak-hashability guards match calculateSplash exactly", () => {
  // The whole justification for folding calculateSplash's RangeError into
  // BuildException is that buildRecord's guards mirror calculateSplash's own
  // preconditions exactly — not "closely" or "usually". Each case below is
  // classified against the REAL calculateSplash, not any verdict this file
  // bakes in, so a future change to either side that breaks the
  // correspondence surfaces as a failure here: a peak calculateSplash would
  // happily hash but buildRecord rejects fails via `.rejects.toThrow`, and a
  // peak calculateSplash refuses but buildRecord builds fails via the
  // unhandled rejection never firing.
  //
  // mz is never negative here (0 is the smallest value used) and
  // relativeIntensity is always a safe constant, so PEAK_MZ_NEGATIVE and the
  // PEAK_RELATIVE_INTENSITY_* guards — which are NOT part of this fold, and
  // deliberately still disagree with calculateSplash's own (inadequate, in
  // the mz case; irrelevant, in the relativeIntensity case) opinion — never
  // fire and so never confound the comparison.

  const mzValues = [0, 100.25, Number.NaN, Number.POSITIVE_INFINITY];
  const intensityValues = [
    0,
    100,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  const singlePeakCases: Array<{ label: string; peaks: Peak[] }> = [];
  for (const mz of mzValues) {
    for (const intensity of intensityValues) {
      singlePeakCases.push({
        label: `single peak, mz=${mz} intensity=${intensity}`,
        peaks: [{ mz, intensity, relativeIntensity: 999 }],
      });
    }
  }

  const multiPeakCases: Array<{ label: string; peaks: Peak[] }> = [
    {
      label: 'two ordinary peaks',
      peaks: [
        { mz: 100.25, intensity: 100, relativeIntensity: 999 },
        { mz: 200, intensity: 50, relativeIntensity: 500 },
      ],
    },
    {
      label: 'first peak has a non-finite mz, second is ordinary',
      peaks: [
        { mz: Number.NaN, intensity: 100, relativeIntensity: 999 },
        { mz: 200, intensity: 50, relativeIntensity: 500 },
      ],
    },
    {
      label: 'both peaks have zero intensity',
      peaks: [
        { mz: 100.25, intensity: 0, relativeIntensity: 0 },
        { mz: 200, intensity: 0, relativeIntensity: 0 },
      ],
    },
    {
      label: 'one peak zero intensity, one ordinary',
      peaks: [
        { mz: 100.25, intensity: 0, relativeIntensity: 0 },
        { mz: 200, intensity: 50, relativeIntensity: 500 },
      ],
    },
  ];

  const cases = [...singlePeakCases, ...multiPeakCases];

  it('generates single- and multi-peak cases covering every calculateSplash precondition', () => {
    expect(singlePeakCases).toHaveLength(24);
    expect(multiPeakCases).toHaveLength(4);
  });

  it.each(cases)('$label', async ({ peaks }) => {
    let splashRejects = false;
    try {
      await calculateSplash(
        peaks.map((p) => ({ mz: p.mz, intensity: p.intensity })),
      );
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      splashRejects = true;
    }

    let buildRejects = false;
    try {
      await buildRecord({ ...minimal(), PK$PEAK: peaks });
    } catch (error) {
      if (!(error instanceof BuildException)) {
        throw error;
      }
      buildRejects = true;
    }

    expect(buildRejects).toBe(splashRejects);
  });
});

describe('buildRecord rejects an ACCESSION that could inject header fields', () => {
  it('throws when ACCESSION contains a newline', async () => {
    await expect(
      buildRecord({
        ACCESSION: 'MSBNK-x-1\nAUTHORS: Attacker A',
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when ACCESSION contains a carriage return', async () => {
    await expect(
      buildRecord({
        ACCESSION: 'MSBNK-x-1\rAUTHORS: Attacker A',
      }),
    ).rejects.toThrow(BuildException);
  });
});

describe('buildRecord rejects an ACCESSION that could not be read back', () => {
  it('throws when ACCESSION is empty', async () => {
    // serializeRecord emits "ACCESSION: ", and parseRecord treats an empty
    // ACCESSION as missing and throws — this could never round-trip.
    await expect(buildRecord({ ACCESSION: '' })).rejects.toThrow(
      BuildException,
    );
  });

  it('throws when ACCESSION is whitespace-only', async () => {
    await expect(buildRecord({ ACCESSION: '   ' })).rejects.toThrow(
      BuildException,
    );
  });

  it('throws when ACCESSION has leading whitespace', async () => {
    // parseRecord trims the value after the colon, so this would reparse to
    // a different string than the one supplied.
    await expect(
      buildRecord({ ACCESSION: '  MSBNK-test-TST00001' }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when ACCESSION has trailing whitespace', async () => {
    await expect(
      buildRecord({ ACCESSION: 'MSBNK-test-TST00001  ' }),
    ).rejects.toThrow(BuildException);
  });

  it('accepts an ACCESSION with no leading or trailing whitespace', async () => {
    const record = await buildRecord({ ACCESSION: 'MSBNK-test-TST00001' });

    expect(record.ACCESSION).toBe('MSBNK-test-TST00001');
  });
});

describe('buildRecord rejects a value that cannot round-trip in any field the serializer writes verbatim', () => {
  // record-serializer.ts writes each of these fields — or, for an
  // array-valued field, each element — onto its own line without escaping.
  // ACCESSION has its own guard above and is covered separately; this covers
  // the rest of the verbatim surface. Imported from build-record.ts rather
  // than hand-copied, so a field added to either list there is automatically
  // covered here too (see checkVerbatimText's own docstring for how each
  // check below was derived and measured).

  it.each(VERBATIM_STRING_FIELDS)(
    'throws when %s contains a newline',
    async (field) => {
      await expect(
        buildRecord({
          ...minimal(),
          [field]: 'line one\nCOPYRIGHT: Copyright (C) Attacker',
        }),
      ).rejects.toThrow(BuildException);
    },
  );

  it.each(VERBATIM_ARRAY_FIELDS)(
    'throws when an element of %s contains a newline',
    async (field) => {
      await expect(
        buildRecord({
          ...minimal(),
          [field]: ['line one\nCOPYRIGHT: Copyright (C) Attacker'],
        }),
      ).rejects.toThrow(BuildException);
    },
  );

  it('names the offending field in the error message', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        LICENSE: 'CC BY\nCOPYRIGHT: Copyright (C) Attacker',
      }),
    ).rejects.toThrow(/LICENSE/);
  });

  it.each(VERBATIM_STRING_FIELDS)(
    'drops %s when it is empty',
    async (field) => {
      // record-serializer.ts guards every single-value field with
      // `if (record.FIELD)`, and `''` is falsy — the field would vanish
      // entirely on reparse regardless of what buildRecord does with it, so
      // buildRecord canonicalises it to absent instead of rejecting a draft
      // the parser itself produces without complaint (e.g. `RECORD_TITLE: `).
      const record = await buildRecord({ ...minimal(), [field]: '' });

      expect(record[field]).toBeUndefined();
    },
  );

  it('accepts and drops an empty RECORD_TITLE round-tripped from a real parse', async () => {
    // Regression lock: rejecting this would make buildRecord strictly less
    // capable than parseRecord, which accepts `RECORD_TITLE: ` (empty value)
    // without complaint.
    const parsed = parseRecord(
      'ACCESSION: MSBNK-test-TST00001\nRECORD_TITLE: \n//\n',
    );

    expect(parsed.RECORD_TITLE).toBe('');

    const record = await buildRecord(parsed);

    expect(record.RECORD_TITLE).toBeUndefined();
  });

  it('does not reject an empty element of an array-valued field', async () => {
    // record-serializer.ts's truthiness check guards the array itself, not
    // each element, so an empty-string element still gets its own
    // "FIELD: " line and reparses back to '' unchanged.
    const record = await buildRecord({ ...minimal(), COMMENT: [''] });

    expect(record.COMMENT).toStrictEqual(['']);

    const reparsed = parseRecord(serializeRecord(record));

    expect(reparsed.COMMENT).toStrictEqual(['']);
  });

  it.each(VERBATIM_STRING_FIELDS)(
    'throws when %s has leading or trailing whitespace',
    async (field) => {
      await expect(
        buildRecord({ ...minimal(), [field]: '  padded  ' }),
      ).rejects.toThrow(BuildException);
    },
  );

  it.each(VERBATIM_ARRAY_FIELDS)(
    'throws when an element of %s has leading or trailing whitespace',
    async (field) => {
      await expect(
        buildRecord({ ...minimal(), [field]: ['  padded  '] }),
      ).rejects.toThrow(BuildException);
    },
  );

  // parse-record.ts extracts a field's value with a single `.trim()`, which
  // strips more than plain spaces. Swept on one representative field —
  // AUTHORS — since the predicate is the same `value.trim() !== value` test
  // for every field; the two sweeps above already prove it runs for all 26.
  const untrimmableValues: Record<string, string> = {
    'a leading tab': '\tAB',
    'a trailing tab': 'AB\t',
    'a leading vertical tab': '\vAB',
    'a trailing form feed': 'AB\f',
    'a leading NBSP': ' AB',
    'a trailing EM SPACE': 'AB ',
    'a leading BOM': '﻿AB',
    'all whitespace': '   ',
  };

  it.each(Object.entries(untrimmableValues))(
    'throws when AUTHORS has %s',
    async (_label, value) => {
      await expect(
        buildRecord({ ...minimal(), AUTHORS: value }),
      ).rejects.toThrow(BuildException);
    },
  );

  it('throws when AUTHORS contains a trailing carriage return', async () => {
    // Measured against parse-record.ts: a value's trailing \r sits right up
    // against the join's own '\n', and .trim() strips \r from either end
    // regardless — "AB\r" would reparse as "AB" if allowed through. Rejected
    // like any other untrimmable value.
    await expect(
      buildRecord({ ...minimal(), AUTHORS: 'AB\r' }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when AUTHORS contains an interior carriage return', async () => {
    // A bare interior \r (no \n immediately after it) measurably reparses
    // back to the identical string at the parse-record.ts layer — the line
    // split regex /\r?\n/ only treats \r as part of a boundary when a \n
    // immediately follows, and .trim() never touches a middle character.
    // It is still rejected: validateRecord's SerializationRule normalises
    // ANY \r to \n before comparing but not on the reserialized side, so a
    // record built with one is guaranteed to fail that rule every time.
    await expect(
      buildRecord({ ...minimal(), AUTHORS: 'A\rB' }),
    ).rejects.toThrow(BuildException);
  });
});

describe('buildRecord rejects PK$ANNOTATION rows the format cannot express', () => {
  // PK$ANNOTATION is read back by TOKEN COUNT (table-parsers.ts), not by
  // forming a prefix of [annotation, exactMass, errorPpm] — see
  // checkAnnotationShape's docstring for the full legal/illegal table.
  // buildRecord must refuse a row it cannot serialize and reparse as itself,
  // rather than silently produce a record that round-trips to the wrong data.

  it('throws when exactMass is set without annotation or errorPpm', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, exactMass: 194.0804 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when errorPpm is set without annotation or exactMass', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, errorPpm: 1.2 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation and errorPpm are set without exactMass', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: 'frag', errorPpm: 1.2 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation looks numeric in the {annotation, exactMass} shape', async () => {
    // The 3-token ambiguous case: with no errorPpm, the parser cannot tell a
    // numeric-looking annotation from an exactMass/errorPpm pair.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '194.08', exactMass: 1.2 }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when a prefix-numeric annotation is set in the {annotation, exactMass} shape', async () => {
    // Regression lock for looksNumeric's Number.parseFloat semantics.
    // Number.parseFloat('5-methyl') === 5 — it parses the leading numeric
    // PREFIX and stops at the first non-numeric character — even though the
    // value is plainly text. This must mirror the parser's OWN test exactly:
    // swapping to Number('5-methyl') (NaN — Number() requires the whole
    // string to be numeric) or a full-numeric regex would both treat this as
    // "safe" text and let it through, and it reparses to
    // { exactMass: 5, errorPpm: 194.0804 } with the annotation destroyed —
    // the Critical this whole guard exists to prevent, restored.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: 100.25, annotation: '5-methyl', exactMass: 194.0804 },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws for a second prefix-numeric annotation shape', async () => {
    // Same failure mode as above with a leading digit before a comma.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: 100.25, annotation: '1,2-dimethyl', exactMass: 194.0804 },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation is empty', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '' }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation is whitespace-only', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '   ' }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation contains internal whitespace', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: 'loss of H2O' }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when annotation has leading or trailing whitespace', async () => {
    // Regression lock for the deliberate leading/trailing strictness. This
    // does NOT change the token count on reparse (the parser's line.trim()
    // absorbs it into the separator before splitting), so a later ".trim()
    // normalisation" of this guard would look harmless — but the reparsed
    // string ('frag') would differ from the one supplied (' frag'), which is
    // exactly the silent-corruption shape this guard exists to prevent.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: ' frag' }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when exactMass is not finite', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: 100.25, annotation: 'fragment', exactMass: Number.NaN },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when errorPpm is not finite', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          {
            mz: 100.25,
            annotation: 'fragment',
            exactMass: 194.0804,
            errorPpm: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when mz is NaN', async () => {
    // A non-finite mz serializes as its first token; the parser bails when
    // that token doesn't parse as a number, so the whole row silently
    // vanishes on reparse.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: Number.NaN, annotation: 'fragment' }],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('throws when mz is Infinity', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: Number.POSITIVE_INFINITY, annotation: 'fragment' },
        ],
      }),
    ).rejects.toThrow(BuildException);
  });

  it('names the offending row in the error message', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: 100.25, annotation: 'frag' },
          { mz: 205.5, errorPpm: 1.2 },
        ],
      }),
    ).rejects.toThrow(/205\.5/);
  });

  it('accepts { mz } with no optional fields', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 100.25 }],
    });

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({ mz: 100.25 });
  });

  it('accepts { mz, annotation }', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
    });

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
    });
  });

  it('accepts a numeric-looking annotation alone, and round-trips it', async () => {
    // The 2-token case: the parser assigns parts[1] to `annotation`
    // unconditionally, so there is no ambiguity to guard against here.
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 100.25, annotation: '194.08' }],
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: '194.08',
    });
    expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
      record.PK$ANNOTATION,
    );
    expect(serializeRecord(reparsed)).toBe(once);
  });

  it('accepts { mz, annotation, exactMass }', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [
        { mz: 100.25, annotation: 'fragment', exactMass: 194.0804 },
      ],
    });

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
      exactMass: 194.0804,
    });
  });

  it('accepts { mz, exactMass, errorPpm } without annotation, and reparses as exactMass/errorPpm', async () => {
    // The 3-token both-numeric recovery: table-parsers.ts:207-210 reads
    // [mz, exactMass, errorPpm] correctly, not [mz, annotation].
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 100.25, exactMass: 194.0804, errorPpm: 1.2 }],
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      exactMass: 194.0804,
      errorPpm: 1.2,
    });
    expect(reparsed.PK$ANNOTATION?.[0]?.annotation).toBeUndefined();
    expect(reparsed.PK$ANNOTATION?.[0]?.exactMass).toBe(194.0804);
    expect(reparsed.PK$ANNOTATION?.[0]?.errorPpm).toBe(1.2);
  });

  it('accepts { mz, annotation, exactMass, errorPpm } and round-trips it', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [
        {
          mz: 100.25,
          annotation: 'fragment',
          exactMass: 194.0804,
          errorPpm: 1.2,
        },
      ],
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
      exactMass: 194.0804,
      errorPpm: 1.2,
    });
    expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
      record.PK$ANNOTATION,
    );
    expect(serializeRecord(reparsed)).toBe(once);
  });

  it('accepts a numeric-looking annotation when exactMass and errorPpm are both present, and round-trips it', async () => {
    // The 4-token case: the parser assigns all four positions
    // unconditionally, so a numeric-looking annotation is harmless here.
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [
        { mz: 100.25, annotation: '194.08', exactMass: 1.2, errorPpm: 3 },
      ],
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: '194.08',
      exactMass: 1.2,
      errorPpm: 3,
    });
    expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
      record.PK$ANNOTATION,
    );
    expect(serializeRecord(reparsed)).toBe(once);
  });
});

describe('buildRecord guards against parser-truncated PK$ANNOTATION columns', () => {
  // Real MassBank annotation tables can carry more than 4 columns, e.g.
  // "m/z tentative_formula formula_count exact_mass error(ppm)". The parser
  // keeps only mz and the second token as `annotation`, stashing the rest of
  // the source line in `_original` (table-parsers.ts) rather than in a typed
  // field. RecordDraft's Omit only blocks object literals, so a parsed
  // MassBankRecord — whose PK$ANNOTATION rows carry `_original` at runtime —
  // can still flow into buildRecord.
  //
  // An UNEDITED row like this prints as its own `_original` text verbatim
  // (buildRecord(parseRecord(file)) — the flagship path), so nothing is
  // dropped: no guard fires. The guard exists for when that `_original` is
  // about to be discarded and the row rebuilt from typed fields alone — that
  // happens the moment ANY row in the table has been edited (all-or-nothing,
  // see buildRecord) — because at that point rebuilding this row really
  // would drop the columns the parser never mapped, and reprint it under a
  // header that still claims they exist.

  it('accepts and preserves an unedited row with more than 4 columns', async () => {
    const record = await buildRecord(fiveColumnRecord());

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 59.0134,
      annotation: 'C2H3O2-',
      _original: '59.0134 C2H3O2- 1 59.0133 2.9',
    });
    expect(serializeRecord(record)).toContain('59.0134 C2H3O2- 1 59.0133 2.9');

    const result = await validateRecord(record);

    expect(result.success).toBe(true);
  });

  it('throws when a row with more than 4 columns has been edited', async () => {
    const parsed = fiveColumnRecord();
    const edited = (parsed.PK$ANNOTATION ?? []).map((a) => ({
      ...a,
      mz: a.mz + 0.001,
    }));

    await expect(
      buildRecord({ ...parsed, PK$ANNOTATION: edited }),
    ).rejects.toThrow(BuildException);
    await expect(
      buildRecord({ ...parsed, PK$ANNOTATION: edited }),
    ).rejects.toThrow(/row 0 \(mz 59\.014399999999995\).*5 columns/);
  });

  it('does not reject a parsed row a caller legitimately trimmed to 4 tokens', async () => {
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation exact_mass error(ppm)
  59.0134 C2H3O2- 59.0133 2.9
//
`);

    const record = await buildRecord(parsed);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 59.0134,
      annotation: 'C2H3O2-',
      exactMass: 59.0133,
      errorPpm: 2.9,
      _original: '59.0134 C2H3O2- 59.0133 2.9',
    });
  });

  it('does not reject a hand-built draft row, which never carries _original', async () => {
    // Annotation (the caller-facing type) has no _original field at all, so
    // this guard must be a no-op for the common construction path.
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [
        { mz: 100.25, annotation: 'fragment', exactMass: 194.0804 },
      ],
    });

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
      exactMass: 194.0804,
    });
  });

  it('accepts and preserves an unedited 3-column row with a non-numeric third column', async () => {
    // The 3-token branch only recovers the third column when it looks
    // numeric; otherwise it falls back to [mz, annotation] and drops it.
    // This is a real shape — lipid annotations carry a bracketed identity in
    // the third column, e.g. "494.35 1 [lyso_PC(alkyl-18:0,-)]-".
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z num type
  494.35 1 [lyso_PC(alkyl-18:0,-)]-
//
`);

    const record = await buildRecord(parsed);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 494.35,
      annotation: '1',
      _original: '494.35 1 [lyso_PC(alkyl-18:0,-)]-',
    });
    expect(serializeRecord(record)).toContain(
      '494.35 1 [lyso_PC(alkyl-18:0,-)]-',
    );
  });

  it('throws when an edited 3-column row with a non-numeric third column is rebuilt', async () => {
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z num type
  494.35 1 [lyso_PC(alkyl-18:0,-)]-
//
`);
    const edited = (parsed.PK$ANNOTATION ?? []).map((a) => ({
      ...a,
      mz: a.mz + 0.001,
    }));
    const draft = { ...parsed, PK$ANNOTATION: edited };

    await expect(buildRecord(draft)).rejects.toThrow(BuildException);
    await expect(buildRecord(draft)).rejects.toThrow(
      /row 0 \(mz 494\.351\).*3 columns/,
    );
  });

  it('does not reject a parsed 3-column row whose third column is numeric', async () => {
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z annotation exact_mass
  100.25 fragment 100.24
//
`);

    const record = await buildRecord(parsed);

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
      exactMass: 100.24,
      _original: '100.25 fragment 100.24',
    });
  });
});

describe("buildRecord's BuildError payload is structured, not a message to parse", () => {
  // The structured payload (code, fieldName, rowIndex, property, plus the
  // pre-formatted field display string) is the entire justification for
  // BuildException over a plain aggregated Error — a test that only asserts
  // `.rejects.toThrow(BuildException)` proves nothing about it: swap two
  // BuildErrorCode values, or blank every field, and a class-only assertion
  // stays green regardless. These assert on the payload directly, including
  // a nested annotation-row property (`PK$ANNOTATION[2].exactMass`) and an
  // array-element index (`CH$NAME[1]`), so a code swap or a blanked field
  // turns one of them red.

  it('reports one BuildError per failure, each with its own code and structured location', async () => {
    const draft = {
      ACCESSION: '',
      DATE: '  2026.07.29  ',
      LICENSE: 'CC BY\nCOPYRIGHT: forged',
      CH$NAME: ['ok', '  padded  '],
      PK$PEAK: [
        // Both not-finite AND negative: -Infinity satisfies !Number.isFinite
        // and < 0 at once, so this row alone proves the two relativeIntensity
        // codes are independent, not mutually exclusive.
        {
          mz: 100.25,
          intensity: 100,
          relativeIntensity: Number.NEGATIVE_INFINITY,
        },
        { mz: -50, intensity: 100, relativeIntensity: 999 },
      ],
      PK$ANNOTATION: [
        { mz: 100.25, annotation: 'loss of H2O' },
        { mz: Number.NaN, annotation: 'fragment' },
        // Two ANNOTATION_NOT_FINITE errors on the SAME row, distinguished
        // only by `property` — proves `property`, not `code`, is what a
        // caller must read to tell exactMass and errorPpm apart here.
        {
          mz: 600,
          annotation: 'frag',
          exactMass: Number.NaN,
          errorPpm: Number.POSITIVE_INFINITY,
        },
        { mz: 200, exactMass: 194.08 },
        { mz: 300, errorPpm: 1.2 },
        { mz: 400, annotation: 'frag', errorPpm: 1.2 },
        { mz: 500, annotation: '194.08', exactMass: 1.2 },
      ],
    };

    let caught: unknown;
    try {
      await buildRecord(draft);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const { buildErrors } = caught as BuildException;

    expect(
      buildErrors.map(({ code, fieldName, rowIndex, property, field }) => ({
        code,
        fieldName,
        rowIndex,
        property,
        field,
      })),
    ).toStrictEqual([
      {
        code: 'ACCESSION_EMPTY',
        fieldName: 'ACCESSION',
        rowIndex: undefined,
        property: undefined,
        field: 'ACCESSION',
      },
      {
        code: 'VERBATIM_WHITESPACE',
        fieldName: 'DATE',
        rowIndex: undefined,
        property: undefined,
        field: 'DATE',
      },
      {
        code: 'VERBATIM_LINE_INJECTION',
        fieldName: 'LICENSE',
        rowIndex: undefined,
        property: undefined,
        field: 'LICENSE',
      },
      {
        code: 'VERBATIM_WHITESPACE',
        fieldName: 'CH$NAME',
        rowIndex: 1,
        property: undefined,
        field: 'CH$NAME[1]',
      },
      {
        code: 'PEAK_RELATIVE_INTENSITY_NOT_FINITE',
        fieldName: 'PK$PEAK',
        rowIndex: 0,
        property: 'relativeIntensity',
        field: 'PK$PEAK[0].relativeIntensity',
      },
      {
        code: 'PEAK_RELATIVE_INTENSITY_NEGATIVE',
        fieldName: 'PK$PEAK',
        rowIndex: 0,
        property: 'relativeIntensity',
        field: 'PK$PEAK[0].relativeIntensity',
      },
      {
        code: 'PEAK_MZ_NEGATIVE',
        fieldName: 'PK$PEAK',
        rowIndex: 1,
        property: 'mz',
        field: 'PK$PEAK[1].mz',
      },
      {
        code: 'ANNOTATION_TEXT_NOT_ROUND_TRIPPABLE',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 0,
        property: 'annotation',
        field: 'PK$ANNOTATION[0].annotation',
      },
      {
        code: 'ANNOTATION_NOT_FINITE',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 1,
        property: 'mz',
        field: 'PK$ANNOTATION[1].mz',
      },
      {
        code: 'ANNOTATION_NOT_FINITE',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 2,
        property: 'exactMass',
        field: 'PK$ANNOTATION[2].exactMass',
      },
      {
        code: 'ANNOTATION_NOT_FINITE',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 2,
        property: 'errorPpm',
        field: 'PK$ANNOTATION[2].errorPpm',
      },
      {
        code: 'ANNOTATION_EXACT_MASS_WITHOUT_ANNOTATION',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 3,
        property: undefined,
        field: 'PK$ANNOTATION[3]',
      },
      {
        code: 'ANNOTATION_ERROR_PPM_WITHOUT_ANNOTATION',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 4,
        property: undefined,
        field: 'PK$ANNOTATION[4]',
      },
      {
        code: 'ANNOTATION_ERROR_PPM_WITHOUT_EXACT_MASS',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 5,
        property: undefined,
        field: 'PK$ANNOTATION[5]',
      },
      {
        code: 'ANNOTATION_TEXT_LOOKS_NUMERIC',
        fieldName: 'PK$ANNOTATION',
        rowIndex: 6,
        property: undefined,
        field: 'PK$ANNOTATION[6]',
      },
    ]);

    // 15 failures is over formatMessage's summary threshold: the aggregate
    // Error.message must summarise rather than concatenate all 15 in full.
    expect(caught).toHaveProperty(
      'message',
      expect.stringMatching(
        /^15 problems building the record: .*and \d+ more \(see error\.buildErrors\)\.$/,
      ),
    );
  });

  it('does not summarise the aggregate message at or under the threshold', async () => {
    // Regression lock for formatMessage's SUMMARY_THRESHOLD boundary: three
    // failures must still print in full, one per line, not as a summary.
    let caught: unknown;
    try {
      await buildRecord({
        ACCESSION: '',
        PK$PEAK: [{ mz: -1, intensity: 10, relativeIntensity: -5 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const buildException = caught as BuildException;

    expect(buildException.buildErrors).toHaveLength(3);
    expect(buildException.message).not.toContain(
      'more (see error.buildErrors)',
    );
    expect(buildException.message.split('\n')).toHaveLength(3);
  });

  it('does not double the field name in the aggregate message when a BuildError message already names it', async () => {
    // checkAccession/checkVerbatimText's messages already start with their
    // own field ("ACCESSION must not...", "LICENSE must not..."). formatMessage
    // must not also prefix "ACCESSION: " in front of that.
    let caught: unknown;
    try {
      await buildRecord({ ACCESSION: '  padded  ' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);
    expect((caught as BuildException).message).not.toMatch(
      /^ACCESSION: ACCESSION/,
    );
    expect((caught as BuildException).message).toMatch(/^ACCESSION must not/);
  });

  it('reports ACCESSION_LINE_INJECTION and ACCESSION_WHITESPACE with no rowIndex or property', async () => {
    let caught: unknown;
    try {
      await buildRecord({ ACCESSION: 'MSBNK-x-1\nAUTHORS: Attacker A' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const { buildErrors } = caught as BuildException;

    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0]).toMatchObject({
      code: 'ACCESSION_LINE_INJECTION',
      fieldName: 'ACCESSION',
      field: 'ACCESSION',
    });
    expect(buildErrors[0]).not.toHaveProperty('rowIndex');
    expect(buildErrors[0]).not.toHaveProperty('property');

    let caughtWhitespace: unknown;
    try {
      await buildRecord({ ACCESSION: '  MSBNK-test-TST00001' });
    } catch (error) {
      caughtWhitespace = error;
    }

    expect(caughtWhitespace).toBeInstanceOf(BuildException);

    const { buildErrors: whitespaceErrors } =
      caughtWhitespace as BuildException;

    expect(whitespaceErrors).toHaveLength(1);
    expect(whitespaceErrors[0]).toMatchObject({
      code: 'ACCESSION_WHITESPACE',
      fieldName: 'ACCESSION',
      field: 'ACCESSION',
    });
  });

  it('reports ANNOTATION_DISCARDED_COLUMN with a rowIndex but no property — the failure spans the whole row', async () => {
    const parsed = fiveColumnRecord();
    const edited = (parsed.PK$ANNOTATION ?? []).map((a) => ({
      ...a,
      mz: a.mz + 0.001,
    }));

    let caught: unknown;
    try {
      await buildRecord({ ...parsed, PK$ANNOTATION: edited });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const { buildErrors } = caught as BuildException;

    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0]).toMatchObject({
      code: 'ANNOTATION_DISCARDED_COLUMN',
      fieldName: 'PK$ANNOTATION',
      rowIndex: 0,
      field: 'PK$ANNOTATION[0]',
    });
    // The failure spans the whole row's shape, not one property of it.
    expect(buildErrors[0]).not.toHaveProperty('property');
  });

  it('reports ANNOTATION_ORIGINAL_LINE_INJECTION and ANNOTATION_ORIGINAL_UNREADABLE with property "_original"', async () => {
    const injected: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: '100.25 frag\n  999.99 FORGED 1 999.98 0.1',
    };
    let caught: unknown;
    try {
      await buildRecord({ ...minimal(), PK$ANNOTATION: [injected] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BuildException);

    const { buildErrors } = caught as BuildException;

    // The poisoned _original also makes wasAnnotationRowEdited report this
    // row as edited (see reparseAnnotationOriginal), which turns off
    // preserveOriginals for the table and so ALSO runs
    // checkAnnotationDiscardedColumns against the same 7-token row — a real
    // second, independent failure, not a test artifact.
    expect(buildErrors).toHaveLength(2);

    const lineInjection = buildErrors.find(
      (error) => error.code === 'ANNOTATION_ORIGINAL_LINE_INJECTION',
    );

    expect(lineInjection).toMatchObject({
      fieldName: 'PK$ANNOTATION',
      rowIndex: 0,
      property: '_original',
      field: 'PK$ANNOTATION[0]._original',
    });

    const unreadable: AnnotationWithOriginal = {
      mz: 100.25,
      annotation: 'frag',
      _original: 'PK$NUM_PEAK: notanumber',
    };
    let caughtUnreadable: unknown;
    try {
      await buildRecord({ ...minimal(), PK$ANNOTATION: [unreadable] });
    } catch (error) {
      caughtUnreadable = error;
    }

    expect(caughtUnreadable).toBeInstanceOf(BuildException);

    const { buildErrors: unreadableErrors } =
      caughtUnreadable as BuildException;

    expect(unreadableErrors).toHaveLength(1);
    expect(unreadableErrors[0]).toMatchObject({
      code: 'ANNOTATION_ORIGINAL_UNREADABLE',
      fieldName: 'PK$ANNOTATION',
      rowIndex: 0,
      property: '_original',
      field: 'PK$ANNOTATION[0]._original',
    });
  });

  it('keeps buildErrors readonly at the type level', async () => {
    let caught: unknown;
    try {
      await buildRecord({ ACCESSION: '' });
    } catch (error) {
      caught = error;
    }
    const buildException = caught as BuildException;
    const firstError = firstOf(buildException.buildErrors);

    // @ts-expect-error buildErrors is `readonly BuildError[]` — push must not
    // type-check. If this stops erroring (e.g. the field is ever widened back
    // to a plain array), `check-types` fails on the unused `@ts-expect-error`
    // directive itself, so this is a real, enforced regression lock, not a
    // runtime-only assertion (readonly is erased at runtime — JS still lets
    // this call through once the type system is bypassed, which is exactly
    // why the compile-time check above is the one that matters).
    buildException.buildErrors.push(firstError);

    expect(buildException.buildErrors.length).toBeGreaterThan(0);
  });
});

describe('property: buildRecord PK$ANNOTATION accept/reject matches round-trip reality', () => {
  // A regression lock that only checks "does this throw" can drift out of
  // sync with the parser and never notice — e.g. a change to table-parsers.ts's
  // own numeric test could leave every hand-written case above green while
  // buildRecord silently became over- or under-strict relative to what the
  // parser actually does today. Each case below is classified against the
  // REAL parser (via wouldRoundTripIfRebuilt), not against any verdict this
  // file bakes in, so a buildRecord/parser disagreement in EITHER direction
  // surfaces as a failure: a case classified "accepts" whose buildRecord call
  // rejects fails via the unhandled rejection, and a case classified
  // "rejects" whose buildRecord call resolves fails via `.rejects`.

  describe('sweep 1: annotation optional fields x annotation text shapes', () => {
    const mz = 100.25;
    const exactMassValue = 194.0804;
    const errorPpmValue = 1.2;
    const textShapes: Record<string, string> = {
      'non-numeric': 'fragment',
      'prefix-numeric': '5-methyl',
      empty: '',
      whitespace: '   ',
      'multi-word': 'loss of H2O',
    };
    const fieldCombos = [
      { exactMass: false, errorPpm: false },
      { exactMass: true, errorPpm: false },
      { exactMass: false, errorPpm: true },
      { exactMass: true, errorPpm: true },
    ];

    const cases: Array<{ label: string; row: Annotation }> = [];
    for (const combo of fieldCombos) {
      const comboLabel = `${combo.exactMass ? '+exactMass' : ''}${combo.errorPpm ? '+errorPpm' : ''}`;
      const optional = {
        ...(combo.exactMass ? { exactMass: exactMassValue } : {}),
        ...(combo.errorPpm ? { errorPpm: errorPpmValue } : {}),
      };

      cases.push({
        label: `no annotation${comboLabel || ' (bare mz)'}`,
        row: { mz, ...optional },
      });
      for (const [shapeName, text] of Object.entries(textShapes)) {
        cases.push({
          label: `annotation=${shapeName}${comboLabel}`,
          row: { mz, annotation: text, ...optional },
        });
      }
    }

    const accepted = cases.filter((c) => wouldRoundTripIfRebuilt(c.row));
    const rejected = cases.filter((c) => !wouldRoundTripIfRebuilt(c.row));

    it('classifies both accepted and rejected cases', () => {
      expect(cases).toHaveLength(24);
      expect(accepted.length).toBeGreaterThan(0);
      expect(rejected.length).toBeGreaterThan(0);
    });

    it.each(accepted)('accepts and round-trips $label', async ({ row }) => {
      const built = await buildRecord({ ...minimal(), PK$ANNOTATION: [row] });
      const reparsed = parseRecord(serializeRecord(built));

      expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
        stripOriginal(built.PK$ANNOTATION),
      );
    });

    it.each(rejected)(
      'rejects $label because rebuilding it would lose or change data',
      async ({ row }) => {
        await expect(
          buildRecord({ ...minimal(), PK$ANNOTATION: [row] }),
        ).rejects.toThrow(BuildException);
      },
    );
  });

  describe('sweep 2: numeric/non-numeric column patterns for 1 to 6 source columns', () => {
    // Column 1 (mz) is always numeric — a non-numeric first token means the
    // parser drops the whole line, which is not an interesting shape to
    // sweep. Each of the remaining columns 2..N is independently either a
    // representative numeric token or a representative non-numeric one:
    // 2^0 + 2^1 + ... + 2^5 = 63 patterns across N = 1..6. Every row here is
    // sourced from the real parser and left unedited, so the discarded-column
    // guard never applies (see wasAnnotationRowEdited/preserveOriginals in
    // build-record.ts — an unedited row always prints as its own source
    // text, whatever its column count) — EXCEPT the 4-column branch, which
    // maps every token unconditionally with no numeric test at all
    // (table-parsers.ts): a non-numeric token in the exactMass or errorPpm
    // position parses to NaN, which buildRecord must still refuse regardless
    // of preservation. `isRepresentable` classifies exactly that, independent
    // of buildRecord's own finiteness check.

    const mzToken = '100.25';
    const numericToken = '1.5';
    const nonNumericToken = 'frag';

    const cases: Array<{ label: string; row: AnnotationWithOriginal }> = [];
    for (let columnCount = 1; columnCount <= 6; columnCount++) {
      const trailingCount = columnCount - 1;
      const patternCount = 2 ** trailingCount;

      for (let pattern = 0; pattern < patternCount; pattern++) {
        const tokens = [mzToken];
        const shape: string[] = [];
        for (let position = 0; position < trailingCount; position++) {
          const isNumeric = ((pattern >> position) & 1) === 1;
          tokens.push(isNumeric ? numericToken : nonNumericToken);
          shape.push(isNumeric ? 'num' : 'text');
        }
        const row = parseAnnotationText(tokens.join(' '));
        if (row !== undefined) {
          cases.push({
            label: `${columnCount} columns, pattern [${shape.join(',')}]`,
            row,
          });
        }
      }
    }

    const representable = cases.filter((c) => isRepresentable(c.row));
    const unrepresentable = cases.filter((c) => !isRepresentable(c.row));

    it('generates all 63 column patterns, some representable and some not', () => {
      expect(cases).toHaveLength(63);
      expect(representable.length).toBeGreaterThan(0);
      expect(unrepresentable.length).toBeGreaterThan(0);
    });

    it.each(representable)('accepts and preserves $label', async ({ row }) => {
      const built = await buildRecord({ ...minimal(), PK$ANNOTATION: [row] });

      // Preservation must be verbatim: a reparse-of-serialize check alone
      // cannot tell "preserved the real source" apart from "consistently
      // truncated the real source".
      expect(built.PK$ANNOTATION?.[0]?._original).toBe(row._original);

      const reparsed = parseRecord(serializeRecord(built));

      expect(stripOriginal(reparsed.PK$ANNOTATION)).toStrictEqual(
        stripOriginal(built.PK$ANNOTATION),
      );
    });

    it.each(unrepresentable)(
      'rejects $label because a mapped numeric field is not finite',
      async ({ row }) => {
        await expect(
          buildRecord({ ...minimal(), PK$ANNOTATION: [row] }),
        ).rejects.toThrow(BuildException);
      },
    );
  });
});

describe('the binding correctness property', () => {
  it('produces text that is a fixed point of serialize∘parse', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(stripOriginal(reparsed.PK$PEAK)).toStrictEqual(record.PK$PEAK);
    expect(serializeRecord(reparsed)).toBe(once);
  });

  it('is a fixed point with COMMENT present', async () => {
    // COMMENT belongs in the header block. A serializer that emits it after
    // MS$FOCUSED_ION breaks the round trip, and preserved MGF params (SCANS,
    // INCHIKEY) put COMMENT on most imported spectra, so this is the common
    // case rather than an edge one.
    const record = await buildRecord({
      ...minimal(),
      COMMENT: ['SCANS 1', 'INCHIKEY RYYVLZVUVIJVGH-UHFFFAOYSA-N'],
      PK$PEAK: unsorted(),
    });
    const once = serializeRecord(record);
    const reparsed = parseRecord(once);

    expect(stripOriginal(reparsed.PK$PEAK)).toStrictEqual(record.PK$PEAK);
    expect(serializeRecord(reparsed)).toBe(once);
  });
});

describe('buildRecord against the sample fixtures', () => {
  // The rest of this file constructs drafts by hand. These fixtures are real
  // MassBank records exercised through the full parse -> buildRecord ->
  // serialize -> reparse pipeline, so a defect that only shows up on
  // real-world field combinations (rather than a hand-picked minimal draft)
  // has a chance to surface here.
  const fixtures = [
    'MSBNK-test-TST00001.txt',
    'MSBNK-test-TST00002.txt',
    'MSBNK-test-TST00003.txt',
    // TST00004 carries a real 5-column PK$ANNOTATION table (trimmed from a
    // MassBank.eu record) — see the "parser-truncated columns" describe
    // block above for why an unedited row like this builds successfully.
    'MSBNK-test-TST00004.txt',
  ];

  it.each(fixtures)('round-trips %s and validates green', async (name) => {
    const original = await readFile(
      join(import.meta.dirname, '..', 'data', name),
      'utf8',
    );
    const parsed = parseRecord(original);
    const rebuilt = await buildRecord(parsed);
    const reparsed = parseRecord(serializeRecord(rebuilt));

    // Whole-record comparison, not just the peak tables: buildRecord could
    // silently drop or mangle any header field (RECORD_TITLE, DATE, AUTHORS,
    // CH$*, AC$*, MS$*, SP$*) and a peak-tables-only check would never catch
    // it — that copy step is exactly what this PR adds.
    expect(normalizeForComparison(reparsed)).toStrictEqual(
      normalizeForComparison(parsed),
    );

    const result = await validateRecord(rebuilt);

    expect(result.success).toBe(true);
  });
});
