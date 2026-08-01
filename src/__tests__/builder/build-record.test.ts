import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildRecord } from '../../builder/build-record.ts';
import { validateRecord } from '../../builder/validate-record.ts';
import { parseRecord } from '../../parser/parse-record.ts';
import type { InternalRecord } from '../../record.ts';
import { serializeRecord } from '../../serializer/record-serializer.ts';

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
 * replaces rather than preserves — `PK$SPLASH` (recomputed from the peaks),
 * `PK$NUM_PEAK` (derived from the peak count), and `_PK$ANNOTATION_HEADER`
 * (`buildRecord` always emits its own canonical header) — and strips
 * `_original` from every peak/annotation row (see `stripOriginal`). Every
 * other field must match exactly, or `buildRecord` silently dropped or
 * mangled something it has no business touching.
 * @param record - the record to normalise
 * @returns the record with the recomputed fields omitted and `_original` stripped
 */
function normalizeForComparison(record: InternalRecord) {
  const {
    PK$SPLASH,
    PK$NUM_PEAK,
    _PK$ANNOTATION_HEADER,
    PK$PEAK,
    PK$ANNOTATION,
    ...rest
  } = record;

  return {
    ...rest,
    PK$PEAK: stripOriginal(PK$PEAK),
    PK$ANNOTATION: stripOriginal(PK$ANNOTATION),
  };
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

  it('throws on a spectrum that cannot be hashed', async () => {
    // Propagated deliberately. SplashRule swallows the same error; the builder
    // does not, because an all-zero spectrum is not publishable.
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: 0, relativeIntensity: 0 }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('drops a stale _PK$ANNOTATION_HEADER carried in from a parsed record', async () => {
    // RecordDraft's Omit only blocks object literals — a caller can still
    // pass a parsed InternalRecord through, whose header would then outlive
    // a rebuild with a different column count.
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

    expect(rebuilt._PK$ANNOTATION_HEADER).toBeUndefined();
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
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
  });

  it('throws when relativeIntensity is negative', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: 100, relativeIntensity: -1 }],
      }),
    ).rejects.toThrow(RangeError);
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

describe('buildRecord rejects an ACCESSION that could inject header fields', () => {
  it('throws when ACCESSION contains a newline', async () => {
    await expect(
      buildRecord({
        ACCESSION: 'MSBNK-x-1\nAUTHORS: Attacker A',
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when ACCESSION contains a carriage return', async () => {
    await expect(
      buildRecord({
        ACCESSION: 'MSBNK-x-1\rAUTHORS: Attacker A',
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('buildRecord rejects an ACCESSION that could not be read back', () => {
  it('throws when ACCESSION is empty', async () => {
    // serializeRecord emits "ACCESSION: ", and parseRecord treats an empty
    // ACCESSION as missing and throws — this could never round-trip.
    await expect(buildRecord({ ACCESSION: '' })).rejects.toThrow(RangeError);
  });

  it('throws when ACCESSION is whitespace-only', async () => {
    await expect(buildRecord({ ACCESSION: '   ' })).rejects.toThrow(RangeError);
  });

  it('throws when ACCESSION has leading whitespace', async () => {
    // parseRecord trims the value after the colon, so this would reparse to
    // a different string than the one supplied.
    await expect(
      buildRecord({ ACCESSION: '  MSBNK-test-TST00001' }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when ACCESSION has trailing whitespace', async () => {
    await expect(
      buildRecord({ ACCESSION: 'MSBNK-test-TST00001  ' }),
    ).rejects.toThrow(RangeError);
  });

  it('accepts an ACCESSION with no leading or trailing whitespace', async () => {
    const record = await buildRecord({ ACCESSION: 'MSBNK-test-TST00001' });

    expect(record.ACCESSION).toBe('MSBNK-test-TST00001');
  });
});

describe('buildRecord rejects a newline in any field the serializer writes verbatim', () => {
  // record-serializer.ts writes each of these fields — or, for an
  // array-valued field, each element — onto its own line without escaping.
  // A newline inside one would inject the text that follows it as forged
  // lines once the record is reparsed. ACCESSION has its own guard above and
  // is covered separately; this covers the rest of the verbatim surface.

  const stringFields = [
    'DEPRECATED',
    'RECORD_TITLE',
    'DATE',
    'AUTHORS',
    'LICENSE',
    'COPYRIGHT',
    'PUBLICATION',
    'PROJECT',
    'CH$COMPOUND_CLASS',
    'CH$FORMULA',
    'CH$EXACT_MASS',
    'CH$SMILES',
    'CH$IUPAC',
    'AC$INSTRUMENT',
    'AC$INSTRUMENT_TYPE',
    'SP$SCIENTIFIC_NAME',
    'SP$LINEAGE',
    'SP$SAMPLE',
  ] as const;

  it.each(stringFields)('throws when %s contains a newline', async (field) => {
    await expect(
      buildRecord({
        ...minimal(),
        [field]: 'line one\nCOPYRIGHT: Copyright (C) Attacker',
      }),
    ).rejects.toThrow(RangeError);
  });

  const arrayFields = [
    'COMMENT',
    'CH$NAME',
    'CH$LINK',
    'AC$MASS_SPECTROMETRY',
    'AC$CHROMATOGRAPHY',
    'MS$FOCUSED_ION',
    'MS$DATA_PROCESSING',
    'SP$LINK',
  ] as const;

  it.each(arrayFields)(
    'throws when an element of %s contains a newline',
    async (field) => {
      await expect(
        buildRecord({
          ...minimal(),
          [field]: ['line one\nCOPYRIGHT: Copyright (C) Attacker'],
        }),
      ).rejects.toThrow(RangeError);
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

  it('does not reject a bare carriage return with no newline', async () => {
    // parse-record.ts splits on /\r?\n/ — a bare \r starts no new line, so a
    // value containing one round-trips unchanged and must not be rejected.
    const record = await buildRecord({
      ...minimal(),
      RECORD_TITLE: 'abc\rdef',
    });

    expect(record.RECORD_TITLE).toBe('abc\rdef');
  });
});

describe('buildRecord rejects PK$ANNOTATION rows the format cannot express', () => {
  // PK$ANNOTATION is read back by TOKEN COUNT (table-parsers.ts), not by
  // forming a prefix of [annotation, exactMass, errorPpm] — see
  // assertExpressibleAnnotation's docstring for the full legal/illegal table.
  // buildRecord must refuse a row it cannot serialize and reparse as itself,
  // rather than silently produce a record that round-trips to the wrong data.

  it('throws when exactMass is set without annotation or errorPpm', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, exactMass: 194.0804 }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when errorPpm is set without annotation or exactMass', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, errorPpm: 1.2 }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when annotation and errorPpm are set without exactMass', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: 'frag', errorPpm: 1.2 }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when annotation looks numeric in the {annotation, exactMass} shape', async () => {
    // The 3-token ambiguous case: with no errorPpm, the parser cannot tell a
    // numeric-looking annotation from an exactMass/errorPpm pair.
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '194.08', exactMass: 1.2 }],
      }),
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
  });

  it('throws when annotation is empty', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '' }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when annotation is whitespace-only', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: '   ' }],
      }),
    ).rejects.toThrow(RangeError);
  });

  it('throws when annotation contains internal whitespace', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [{ mz: 100.25, annotation: 'loss of H2O' }],
      }),
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
  });

  it('throws when exactMass is not finite', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: 100.25, annotation: 'fragment', exactMass: Number.NaN },
        ],
      }),
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
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
    ).rejects.toThrow(RangeError);
  });

  it('throws when mz is Infinity', async () => {
    await expect(
      buildRecord({
        ...minimal(),
        PK$ANNOTATION: [
          { mz: Number.POSITIVE_INFINITY, annotation: 'fragment' },
        ],
      }),
    ).rejects.toThrow(RangeError);
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
  // InternalRecord — whose PK$ANNOTATION rows carry `_original` at runtime —
  // can still flow into buildRecord. Without a guard, buildRecord(parsed)
  // would silently drop those extra columns and reprint the row under the
  // canonical 4-column header as if it never had more.

  it('throws when a parsed row carries more than 4 columns', async () => {
    await expect(buildRecord(fiveColumnRecord())).rejects.toThrow(RangeError);
  });

  it('names the row and the real column count in the error message', async () => {
    await expect(buildRecord(fiveColumnRecord())).rejects.toThrow(
      /row 0 \(mz 59\.0134\).*5 columns/,
    );
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

  it('throws when a parsed 3-column row has a non-numeric third column', async () => {
    // The 3-token branch only recovers the third column when it looks
    // numeric; otherwise it falls back to [mz, annotation] and drops it.
    // This is a real shape — lipid annotations carry a bracketed identity in
    // the third column, e.g. "494.35 1 [lyso_PC(alkyl-18:0,-)]-".
    const parsed = parseRecord(`ACCESSION: MSBNK-test-TST00001
PK$ANNOTATION: m/z num type
  494.35 1 [lyso_PC(alkyl-18:0,-)]-
//
`);

    await expect(buildRecord(parsed)).rejects.toThrow(RangeError);
    await expect(buildRecord(parsed)).rejects.toThrow(
      /row 0 \(mz 494\.35\).*3 columns/,
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
    });
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
