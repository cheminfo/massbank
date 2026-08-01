import { describe, expect, it } from 'vitest';

import { buildRecord } from '../../builder/build-record.ts';
import { parseRecord } from '../../parser/parse-record.ts';
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

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: '194.08',
    });
    expect(serializeRecord(parseRecord(once))).toBe(once);
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

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: 'fragment',
      exactMass: 194.0804,
      errorPpm: 1.2,
    });
    expect(serializeRecord(parseRecord(once))).toBe(once);
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

    expect(record.PK$ANNOTATION?.[0]).toStrictEqual({
      mz: 100.25,
      annotation: '194.08',
      exactMass: 1.2,
      errorPpm: 3,
    });
    expect(serializeRecord(parseRecord(once))).toBe(once);
  });
});

describe('the binding correctness property', () => {
  it('produces text that is a fixed point of serialize∘parse', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });
    const once = serializeRecord(record);

    expect(serializeRecord(parseRecord(once))).toBe(once);
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

    expect(serializeRecord(parseRecord(once))).toBe(once);
  });
});
