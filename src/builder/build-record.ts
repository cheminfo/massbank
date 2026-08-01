import type {
  Annotation,
  AnnotationWithOriginal,
  InternalRecord,
  Peak,
} from '../record.ts';
import { calculateSplash } from '../splash/calculate-splash.ts';

// A record under construction. _original and _PK$ANNOTATION_HEADER are typed
// out here: they carry round-trip fidelity for text that was parsed, and the
// serializer PREFERS them over the numeric fields — so a draft carrying them
// would print stale rows under a freshly computed SPLASH. The `Omit` only
// blocks object literals (TypeScript's excess-property check does not apply
// to a variable of a wider type), so buildRecord also deletes
// _PK$ANNOTATION_HEADER at runtime — see the delete below.
export type RecordDraft = Partial<
  Omit<InternalRecord, 'PK$PEAK' | 'PK$ANNOTATION' | '_PK$ANNOTATION_HEADER'>
> & {
  ACCESSION: string;
  PK$PEAK?: Peak[];
  PK$ANNOTATION?: Annotation[];
};

/**
 * Mirrors the parser's own numeric test (table-parsers.ts) so buildRecord
 * rejects exactly what the parser cannot tell apart from a number.
 * @param value - the annotation text to test
 * @returns true if the parser would read this text back as a number
 */
function looksNumeric(value: string): boolean {
  return !Number.isNaN(Number.parseFloat(value));
}

/**
 * A row parsed from a real PK$ANNOTATION table can carry a column the parser
 * never mapped into any typed field. table-parsers.ts's per-token-count
 * branches are positional, and not every branch accounts for every token:
 *
 * - 1, 2, or 4 tokens always map every token into a field, unconditionally:
 *   `[mz]`, `[mz, annotation]`, or `[mz, annotation, exactMass, errorPpm]`.
 * - 3 tokens map all 3 only when the THIRD token looks numeric (read as
 *   `[mz, exactMass, errorPpm]` or `[mz, annotation, exactMass]`, depending
 *   on the second token). When the third token does not look numeric, the
 *   branch falls back to `[mz, annotation]` and drops the third token — a
 *   real shape, e.g. lipid annotations such as
 *   `"494.35 1 [lyso_PC(alkyl-18:0,-)]-"`.
 * - 5 or more tokens: no branch handles this; the parser falls back to
 *   `[mz, annotation]` and drops every token from the third onward.
 *
 * `RecordDraft` types `PK$ANNOTATION` as `Annotation[]`, which has no
 * `_original`, but a caller can still pass a parsed `InternalRecord` through
 * — the `Omit` only blocks object literals, not variables — so `_original`
 * can be present at runtime even though the type says otherwise. When a
 * token was dropped this way, rebuilding from the mapped fields alone would
 * silently reprint the row without it, under a header that still claims the
 * dropped column exists.
 *
 * A caller's own edits (which may legitimately reduce the token count, e.g.
 * clearing `errorPpm`) are unaffected: this only inspects `_original`, which
 * a hand-built draft row never carries.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @throws {RangeError} when the parser did not map every token of
 * `row._original` into a typed field
 */
function assertNoDiscardedColumns(
  row: AnnotationWithOriginal,
  index: number,
): void {
  if (row._original === undefined) {
    return;
  }
  const parts = row._original.trim().split(/\s+/);
  const tokenCount = parts.length;

  if (tokenCount === 3) {
    const third = parts[2];
    if (third === undefined || !looksNumeric(third)) {
      throw new RangeError(
        `PK$ANNOTATION row ${index} (mz ${row.mz}): the source row has 3 columns, but the third column ("${third ?? ''}") does not look numeric, so the parser reads this row as [mz, annotation] only — the third column would be lost if this row is rebuilt.`,
      );
    }
    return;
  }

  if (tokenCount >= 5) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${row.mz}): the source row has ${tokenCount} columns, but the parser has no format beyond 4 columns and reads it as [mz, annotation] only — columns beyond the second would be lost if this row is rebuilt.`,
    );
  }
}

/**
 * PK$ANNOTATION rows are whitespace-delimited tokens (table-parsers.ts splits
 * on `/\s+/`). An `annotation` that is empty, whitespace-only, or contains
 * internal whitespace changes the token count on reparse — which the parser
 * reads as an entirely different field layout, not as a multi-word value.
 * Leading/trailing whitespace does NOT change the token count (the parser's
 * `line.trim()` absorbs it into the surrounding separator before splitting),
 * but it is trimmed away on reparse, so the reparsed value is a different
 * string than the one supplied — the same silent-corruption shape with a
 * different cause.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @throws {RangeError} when `annotation` cannot survive as the same string,
 * at the same token position, on reparse
 */
function assertRoundTrippableAnnotationText(
  row: Annotation,
  index: number,
): void {
  if (row.annotation === undefined) {
    return;
  }
  if (row.annotation.length === 0 || /\s/.test(row.annotation)) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${row.mz}): annotation ${JSON.stringify(row.annotation)} is empty, whitespace-only, contains internal whitespace, or has leading/trailing whitespace. ` +
        'PK$ANNOTATION rows are whitespace-delimited tokens — such an annotation either changes the token count on reparse, or is trimmed away on reparse so the reparsed value is a different string.',
    );
  }
}

/**
 * `mz`, `exactMass`, and `errorPpm` are rejected when non-finite because none
 * of them are physical quantities as `NaN` or `Infinity`, and MassBank's text
 * format has no representation for either — not because the parser is
 * guaranteed to lose them. The actual reparse behaviour varies: `NaN` for
 * `mz` does make the parser bail on that token and drop the whole row, but
 * `Infinity` for `mz` reparses fine (`Number.parseFloat('Infinity')` is
 * `Infinity`, so the row survives). `exactMass`/`errorPpm` have no numeric
 * test at all in the 4-token branch, so a non-finite value there would
 * reparse as literally `NaN`/`Infinity` rather than being discarded.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @throws {RangeError} when `mz`, `exactMass`, or `errorPpm` is not finite
 */
function assertFiniteAnnotationValues(row: Annotation, index: number): void {
  if (!Number.isFinite(row.mz)) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${row.mz}): mz is not finite.`,
    );
  }
  if (row.exactMass !== undefined && !Number.isFinite(row.exactMass)) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${row.mz}): exactMass ${row.exactMass} is not finite.`,
    );
  }
  if (row.errorPpm !== undefined && !Number.isFinite(row.errorPpm)) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${row.mz}): errorPpm ${row.errorPpm} is not finite.`,
    );
  }
}

/**
 * PK$ANNOTATION is a positional table read back by TOKEN COUNT, not by the
 * header it was written under (table-parsers.ts:179-224) — so whether a
 * combination of optional fields survives a round-trip depends on which of
 * the parser's token-count branches it lands in, not on forming a prefix of
 * `[annotation, exactMass, errorPpm]`:
 *
 * - `{}` (1 token), `{annotation}` (2 tokens), and
 *   `{annotation, exactMass, errorPpm}` (4 tokens) always round-trip — a
 *   1-token row has no optional field to misread, the parser reads a 2-token
 *   row as `[mz, annotation]` and a 4-token row as `[mz, annotation,
 *   exactMass, errorPpm]` unconditionally, with no numeric test on either
 *   path.
 * - `{exactMass, errorPpm}` (3 tokens, no annotation) round-trips too — the
 *   parser's 3-token branch recognises "both remaining tokens are numeric"
 *   as `[mz, exactMass, errorPpm]`.
 * - `{annotation, exactMass}` (3 tokens, no errorPpm) round-trips ONLY if
 *   `annotation` does not look numeric — the same 3-token branch would
 *   otherwise take the "both numeric" path and mislabel `annotation` as
 *   `exactMass` and the real `exactMass` as `errorPpm`.
 * - `{exactMass}` or `{errorPpm}` alone (2 tokens) never round-trip — the
 *   2-token branch always reads the second token as `annotation`.
 * - `{annotation, errorPpm}` without `exactMass` (3 tokens) never round-trips
 *   — the 3-token branch has no recovery for this shape: `errorPpm` is
 *   misread as `exactMass` and `annotation` is discarded.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @throws {RangeError} when the row cannot be serialized and reparsed as itself
 */
function assertExpressibleAnnotation(row: Annotation, index: number): void {
  assertNoDiscardedColumns(row, index);
  assertRoundTrippableAnnotationText(row, index);
  assertFiniteAnnotationValues(row, index);

  const { annotation, exactMass, errorPpm, mz } = row;

  if (
    annotation === undefined &&
    exactMass !== undefined &&
    errorPpm === undefined
  ) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${mz}): exactMass is set without annotation or errorPpm. ` +
        'The parser reads a 2-token row as [mz, annotation] unconditionally, so this value would come back as annotation text, not exactMass.',
    );
  }
  if (
    annotation === undefined &&
    exactMass === undefined &&
    errorPpm !== undefined
  ) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${mz}): errorPpm is set without annotation or exactMass. ` +
        'The parser reads a 2-token row as [mz, annotation] unconditionally, so this value would come back as annotation text, not errorPpm.',
    );
  }
  if (
    annotation !== undefined &&
    exactMass === undefined &&
    errorPpm !== undefined
  ) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${mz}): errorPpm is set without exactMass. ` +
        'The parser has a 3-token recovery for [annotation, exactMass] and for [exactMass, errorPpm], but none for [annotation, errorPpm] — errorPpm would be misread as exactMass and annotation would be discarded.',
    );
  }
  if (
    annotation !== undefined &&
    exactMass !== undefined &&
    errorPpm === undefined &&
    looksNumeric(annotation)
  ) {
    throw new RangeError(
      `PK$ANNOTATION row ${index} (mz ${mz}): annotation "${annotation}" looks numeric. ` +
        'The parser reads a 3-token [annotation, exactMass] row by testing whether both remaining tokens are numeric; a numeric-looking annotation is then misread as exactMass and the real exactMass is misread as errorPpm.',
    );
  }
}

/**
 * `relativeIntensity` is the one numeric peak field `calculateSplash` never
 * sees — `SplashPeak` is `{mz, intensity}` only — so a bad value here passes
 * silently through the SPLASH computation. Left unchecked, a non-finite
 * value serializes as a literal `NaN`/`Infinity` in the output file, and a
 * negative value is not a meaningful reading against a base peak.
 *
 * `relativeIntensity` is caller-owned: this only validates it, never derives
 * or rescales it. Deriving it would require picking a scale convention
 * MassBank does not fix (base peak 999 vs 100), and on a
 * `buildRecord(parseRecord(file))` round trip it would silently rescale
 * values that were already correct in the source.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @throws {RangeError} when `relativeIntensity` is not finite or is negative
 */
function assertValidRelativeIntensity(peak: Peak, index: number): void {
  if (!Number.isFinite(peak.relativeIntensity) || peak.relativeIntensity < 0) {
    throw new RangeError(
      `PK$PEAK row ${index} (mz ${peak.mz}): relativeIntensity ${peak.relativeIntensity} is not finite or is negative.`,
    );
  }
}

/**
 * Every field record-serializer.ts writes verbatim into the output: a
 * single-value field on its own line, or each element of an array-valued
 * field on its own line each. `ACCESSION` is guarded separately in
 * `buildRecord` — it also derives `validateRecord`'s filename and carries
 * extra rules (non-empty, no padding) that don't apply to the fields here.
 *
 * parse-record.ts splits input on `/\r?\n/`, so the only character that
 * starts a new line on reparse is `\n` (whether or not it's preceded by
 * `\r`) — measured, not assumed: a bare `\r` with no `\n` survives a
 * build → serialize → reparse round trip unchanged, because `.trim()` only
 * strips it from the ends of a value, not from the middle. Rejecting `\r`
 * here too would refuse content that reparses back to itself correctly.
 */
const VERBATIM_STRING_FIELDS = [
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
] as const satisfies ReadonlyArray<keyof InternalRecord>;

const VERBATIM_ARRAY_FIELDS = [
  'COMMENT',
  'CH$NAME',
  'CH$LINK',
  'AC$MASS_SPECTROMETRY',
  'AC$CHROMATOGRAPHY',
  'MS$FOCUSED_ION',
  'MS$DATA_PROCESSING',
  'SP$LINK',
] as const satisfies ReadonlyArray<keyof InternalRecord>;

/**
 * `InternalRecord` fields `buildRecord` deliberately does NOT write verbatim
 * from the draft: `ACCESSION` (guarded separately above, with its own
 * stricter rules — non-empty, no padding), the peak and annotation tables
 * (rebuilt row-by-row from typed fields, never copied as strings), and the
 * fields `buildRecord` always recomputes (`PK$SPLASH`, `PK$NUM_PEAK`) or
 * strips (`_PK$ANNOTATION_HEADER`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used at the type level, by the exhaustiveness check below
const NOT_WRITTEN_VERBATIM = [
  'ACCESSION',
  'PK$SPLASH',
  'PK$NUM_PEAK',
  'PK$PEAK',
  'PK$ANNOTATION',
  '_PK$ANNOTATION_HEADER',
] as const satisfies ReadonlyArray<keyof InternalRecord>;

/**
 * Compile-time exhaustiveness check, anchored on `InternalRecord` rather
 * than `RecordDraft`: the serializer can only ever write a field that
 * exists on `InternalRecord`, so covering every key of that type covers
 * every field the serializer can write. (`RecordDraft`'s `Omit` drops
 * `_PK$ANNOTATION_HEADER` entirely, so a check anchored there would never
 * even see that key.)
 *
 * `UnclassifiedInternalRecordField` is every `InternalRecord` key absent
 * from all three lists above. `AssertNoUnclassifiedFields` only type-checks
 * when its argument extends `never`, so this line fails to compile the
 * moment `InternalRecord` grows a field that isn't in one of the three
 * lists. When it does: read how record-serializer.ts writes the new field,
 * then classify it into `VERBATIM_STRING_FIELDS`, `VERBATIM_ARRAY_FIELDS`,
 * or `NOT_WRITTEN_VERBATIM`. Putting it in `NOT_WRITTEN_VERBATIM` is a
 * decision, not a default — confirm the serializer really doesn't write it
 * verbatim before choosing that list.
 */
type UnclassifiedInternalRecordField = Exclude<
  keyof InternalRecord,
  | (typeof VERBATIM_STRING_FIELDS)[number]
  | (typeof VERBATIM_ARRAY_FIELDS)[number]
  | (typeof NOT_WRITTEN_VERBATIM)[number]
>;
type AssertNoUnclassifiedFields<T extends never> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- never referenced; its only job is to fail tsc if it doesn't compile
type VerbatimFieldListsAreExhaustive =
  AssertNoUnclassifiedFields<UnclassifiedInternalRecordField>;

/**
 * Reject a draft-supplied value the serializer would write verbatim if it
 * contains a newline.
 * @param fieldName - the field (or `field[index]` for an array element)
 * being checked, for error reporting
 * @param value - the draft-supplied string that will be written verbatim
 * @throws {RangeError} when `value` contains a newline, which would inject
 * whatever text follows it as forged lines once the record is reparsed
 */
function assertNoLineInjection(fieldName: string, value: string): void {
  if (value.includes('\n')) {
    throw new RangeError(
      `${fieldName} must not contain a newline. It is written verbatim into the output, so a newline inside it would inject the text that follows it as forged lines once the record is reparsed.`,
    );
  }
}

/**
 * Normalise a draft into a canonical record.
 *
 * Validation cannot detect what this prevents: unsorted peaks, a wrong
 * PK$NUM_PEAK and a stale PK$SPLASH all round-trip cleanly and validate green,
 * because SerializationRule checks self-consistency rather than correctness.
 *
 * Duplicate m/z are preserved deliberately — a duplicate may be a real
 * instrument artifact, and dropping loses data while summing invents it.
 *
 * Never mutates its input. Output is NOT text-identical to a parsed source:
 * `100.2500` canonicalises to `100.25`. Round-trip fidelity is parse/serialize's
 * job; this function's contract is canonical output.
 * @param draft - the record draft to canonicalise
 * @returns the canonicalised record
 * @throws {RangeError} when the peak list is non-empty but cannot be hashed —
 * all-zero intensity, a negative intensity, or a non-finite `mz`/`intensity`.
 * A negative `mz` also throws, but via a different guard inside SPLASH's
 * histogram step, with a message that reads as "empty or all-zero-intensity"
 * even though the spectrum may be neither — see calculate-splash.ts. An empty
 * peak list is dropped rather than hashed, so it never reaches either error.
 * Note SplashRule swallows the same error; the builder does not, because such
 * a spectrum is not publishable.
 * @throws {RangeError} when a peak's `relativeIntensity` is not finite or is
 * negative. `relativeIntensity` is caller-owned — see
 * {@link assertValidRelativeIntensity} — and is never derived or rescaled.
 * @throws {RangeError} when `ACCESSION` contains a newline or carriage
 * return (which would inject extra header lines into the serialized
 * record), is empty or whitespace-only (unreadable back — parseRecord treats
 * an empty ACCESSION as missing), or has leading or trailing whitespace
 * (trimmed away on reparse, so the reparsed value would differ from the one
 * supplied).
 * @throws {RangeError} when any other field record-serializer.ts writes
 * verbatim (or an element of an array-valued one) contains a newline, which
 * would inject the text that follows it as forged lines once the record is
 * reparsed. See {@link VERBATIM_STRING_FIELDS} and
 * {@link VERBATIM_ARRAY_FIELDS} for the full field list.
 * @throws {RangeError} when an annotation row cannot survive a PK$ANNOTATION
 * round-trip: the parser did not map every token of the row's source text
 * into a typed field (a 3-column row whose third column doesn't look
 * numeric, or 5 or more columns) and would lose data if rebuilt;
 * `annotation` is empty, whitespace-only, or contains internal whitespace;
 * `mz`, `exactMass`, or `errorPpm` is not finite; `exactMass` or `errorPpm`
 * is set alone with no `annotation`; `errorPpm` is set with `annotation` but
 * no `exactMass`; or `annotation` looks numeric while `exactMass` is set and
 * `errorPpm` is not. See {@link assertExpressibleAnnotation} for the full
 * legal/illegal table and why it is not simply "a prefix of
 * `[annotation, exactMass, errorPpm]`".
 */
export async function buildRecord(draft: RecordDraft): Promise<InternalRecord> {
  // ACCESSION is the one field buildRecord declares mandatory, and the field
  // validateRecord derives a filename from. serializeRecord writes it as the
  // first line verbatim, so a newline or carriage return inside it injects
  // whatever text follows as forged header lines (e.g. a fake AUTHORS).
  if (/[\n\r]/.test(draft.ACCESSION)) {
    throw new RangeError(
      'ACCESSION must not contain a newline or carriage return.',
    );
  }
  const trimmedAccession = draft.ACCESSION.trim();
  if (trimmedAccession.length === 0) {
    throw new RangeError(
      'ACCESSION must not be empty or whitespace-only — parseRecord treats an empty ACCESSION as missing and throws "ACCESSION field is required" on reparse.',
    );
  }
  if (trimmedAccession !== draft.ACCESSION) {
    throw new RangeError(
      'ACCESSION must not have leading or trailing whitespace — parseRecord trims it on reparse, so the reparsed value would differ from the one supplied.',
    );
  }

  for (const field of VERBATIM_STRING_FIELDS) {
    const value = draft[field];
    if (value !== undefined) {
      assertNoLineInjection(field, value);
    }
  }
  for (const field of VERBATIM_ARRAY_FIELDS) {
    const values = draft[field];
    if (values !== undefined) {
      for (const [index, value] of values.entries()) {
        assertNoLineInjection(`${field}[${index}]`, value);
      }
    }
  }

  const record: InternalRecord = { ...draft };
  // buildRecord always emits its own canonical header for PK$ANNOTATION, so a
  // stale header carried in from a parsed InternalRecord must not survive —
  // otherwise the serializer prints rows under a header that no longer
  // matches them. The RecordDraft type omits this field for object literals,
  // but a caller can still pass an InternalRecord (excess-property checks
  // don't apply to variables), so this also has to be a runtime delete.
  delete record._PK$ANNOTATION_HEADER;

  const peaks = draft.PK$PEAK;
  if (peaks !== undefined && peaks.length > 0) {
    for (const [index, peak] of peaks.entries()) {
      assertValidRelativeIntensity(peak, index);
    }
    // Rebuild each peak from its numeric fields, discarding any _original a
    // caller smuggled through a structural type.
    const sorted = peaks
      .map((p) => ({
        mz: p.mz,
        intensity: p.intensity,
        relativeIntensity: p.relativeIntensity,
      }))
      .toSorted((a, b) => a.mz - b.mz);
    record.PK$PEAK = sorted;
    record.PK$NUM_PEAK = sorted.length;
    // Recompute rather than trust: a wrong SPLASH breaks cross-database matching
    // silently, which is worse than an absent one. calculateSplash is
    // order-insensitive, so sorting first is safe.
    record.PK$SPLASH = await calculateSplash(
      sorted.map((p) => ({ mz: p.mz, intensity: p.intensity })),
    );
  } else {
    delete record.PK$PEAK;
    delete record.PK$NUM_PEAK;
    // A stale hash with no spectrum behind it passes every rule in this
    // library (splash-rule short-circuits when PK$PEAK is empty), so a
    // declared PK$SPLASH must not survive a peakless draft.
    delete record.PK$SPLASH;
  }

  const annotations = draft.PK$ANNOTATION;
  if (annotations !== undefined && annotations.length > 0) {
    for (const [index, row] of annotations.entries()) {
      assertExpressibleAnnotation(row, index);
    }
    record.PK$ANNOTATION = annotations
      .map((a) => ({
        mz: a.mz,
        ...(a.annotation === undefined ? {} : { annotation: a.annotation }),
        ...(a.exactMass === undefined ? {} : { exactMass: a.exactMass }),
        ...(a.errorPpm === undefined ? {} : { errorPpm: a.errorPpm }),
      }))
      .toSorted((a, b) => a.mz - b.mz);
  } else {
    // Keep the canonical shape empty-table-free, matching the PK$NUM_PEAK
    // and PK$SPLASH deletes above rather than carrying an empty array.
    delete record.PK$ANNOTATION;
  }

  return record;
}
