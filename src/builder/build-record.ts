import { parseRecord } from '../parser/parse-record.ts';
import type {
  Annotation,
  AnnotationWithOriginal,
  InternalRecord,
  Peak,
} from '../record.ts';
import { calculateSplash } from '../splash/calculate-splash.ts';

import type { BuildError } from './exceptions.ts';
import { BuildException } from './exceptions.ts';

// A record under construction. PK$PEAK, PK$ANNOTATION, and
// _PK$ANNOTATION_HEADER are typed out of the object-literal shape (the
// `Omit`) because a draft can't declare a row's `_original` through this
// type — TypeScript's excess-property check only fires on object literals,
// not on a variable of a wider type, so a caller can still pass a parsed
// InternalRecord straight through and its rows/header arrive with
// `_original` intact at runtime regardless.
//
// Peaks and annotations then diverge in what buildRecord does with that
// smuggled `_original`: a peak's `_original` feeds a freshly recomputed
// PK$SPLASH, so printing it verbatim could disagree with the hash — it is
// therefore always stripped (every peak is rebuilt from its numeric fields).
// An annotation row's `_original` never reaches PK$SPLASH, so the same risk
// does not apply; buildRecord keeps a row's `_original` (and the table's
// shared header) when NO row in the table has been edited since it was
// parsed — see wasAnnotationRowEdited — and discards them, table-wide, the
// moment any row has.
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
 * Reparse a single PK$ANNOTATION row's `_original` source text through the
 * real parser, to find out what it actually produces from that text today.
 * There is no public entry point for a single line — table-parsers.ts has no
 * exported per-line method — so this builds the smallest record that
 * exercises the same code path. That is faithful because table rows are
 * parsed one line at a time, independently of every other line and of the
 * header text (table-parsers.ts's `AnnotationTableParser.parse` calls
 * `parseAnnotationLine` per line; the header is only ever stored, never
 * consulted to decide a line's shape) — so wrapping a single row in a
 * minimal record reproduces exactly what parsing it as part of the original
 * table produced.
 * @param original - a row's `_original` source text
 * @returns the annotation the parser produces from `original` today, or
 * `undefined` if it drops the line entirely (e.g. a non-numeric first token)
 */
function reparseAnnotationOriginal(original: string): Annotation | undefined {
  const parsed = parseRecord(
    `ACCESSION: reparse-check\nPK$ANNOTATION: m/z\n  ${original}\n//\n`,
  );
  return parsed.PK$ANNOTATION?.[0];
}

/**
 * Compare only the fields the parser can produce, ignoring `_original` and
 * ignoring the boolean-only `annotation`/`exactMass`/`errorPpm` presence and
 * comparing their actual values.
 * @param a - a row's current typed fields
 * @param b - what the parser produced from that row's `_original` today, or
 * `undefined` if it dropped the line entirely
 * @returns true when every field matches exactly
 */
function annotationTypedFieldsMatch(
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
 * Whether a row's typed fields still match what its own `_original` source
 * text reparses to today — measured directly rather than trusted, so a
 * caller cannot claim a row is unedited by fiat. A row with no `_original`
 * (freshly added by a caller, never parsed) has nothing to compare against
 * and is therefore never itself "edited" by this definition — see where
 * this is used for how such a row is still serialized correctly regardless.
 * @param row - the annotation row to check
 * @returns true when `row`'s typed fields diverge from a reparse of its own
 * `_original`
 */
function wasAnnotationRowEdited(row: AnnotationWithOriginal): boolean {
  if (row._original === undefined) {
    return false;
  }
  return !annotationTypedFieldsMatch(
    row,
    reparseAnnotationOriginal(row._original),
  );
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
 * That is only a real loss when the row's `_original` is actually about to
 * be discarded and rebuilt from typed fields. When `preserveOriginals` is
 * true — the whole table round-trips unedited, see `wasAnnotationRowEdited`
 * — this row prints as its own `_original` text verbatim instead, so a
 * column the typed fields don't capture isn't lost, it just isn't reflected
 * in `row.exactMass`/`row.errorPpm`; this check is a no-op in that case.
 *
 * A caller's own edits (which may legitimately reduce the token count, e.g.
 * clearing `errorPpm`) are unaffected: this only inspects `_original`, which
 * a hand-built draft row never carries.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @param preserveOriginals - true when no row in the table has been edited,
 * so this row's `_original` (if any) is being kept rather than discarded
 * @returns a `BuildError` when `_original` is being discarded and the
 * parser did not map every token of `row._original` into a typed field
 */
function checkAnnotationDiscardedColumns(
  row: AnnotationWithOriginal,
  index: number,
  preserveOriginals: boolean,
): BuildError | undefined {
  if (row._original === undefined || preserveOriginals) {
    return undefined;
  }
  const parts = row._original.trim().split(/\s+/);
  const tokenCount = parts.length;
  const field = `PK$ANNOTATION[${index}]`;

  if (tokenCount === 3) {
    const third = parts[2];
    if (third === undefined || !looksNumeric(third)) {
      return {
        code: 'ANNOTATION_DISCARDED_COLUMN',
        field,
        message: `PK$ANNOTATION row ${index} (mz ${row.mz}): the source row has 3 columns, but the third column ("${third ?? ''}") does not look numeric, so the parser reads this row as [mz, annotation] only — the third column would be lost if this row is rebuilt.`,
      };
    }
    return undefined;
  }

  if (tokenCount >= 5) {
    return {
      code: 'ANNOTATION_DISCARDED_COLUMN',
      field,
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): the source row has ${tokenCount} columns, but the parser has no format beyond 4 columns and reads it as [mz, annotation] only — columns beyond the second would be lost if this row is rebuilt.`,
    };
  }
  return undefined;
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
 * @returns a `BuildError` when `annotation` cannot survive as the same
 * string, at the same token position, on reparse
 */
function checkAnnotationRoundTrippableText(
  row: Annotation,
  index: number,
): BuildError | undefined {
  if (row.annotation === undefined) {
    return undefined;
  }
  if (row.annotation.length === 0 || /\s/.test(row.annotation)) {
    return {
      code: 'ANNOTATION_TEXT_NOT_ROUND_TRIPPABLE',
      field: `PK$ANNOTATION[${index}].annotation`,
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): annotation ${JSON.stringify(row.annotation)} is empty, whitespace-only, contains internal whitespace, or has leading/trailing whitespace. PK$ANNOTATION rows are whitespace-delimited tokens — such an annotation either changes the token count on reparse, or is trimmed away on reparse so the reparsed value is a different string.`,
    };
  }
  return undefined;
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
 * @returns a `BuildError` per non-finite field among `mz`, `exactMass`, and
 * `errorPpm` — up to three, since they are independent facts about the row
 */
function checkAnnotationFiniteValues(
  row: Annotation,
  index: number,
): BuildError[] {
  const errors: BuildError[] = [];
  if (!Number.isFinite(row.mz)) {
    errors.push({
      code: 'ANNOTATION_NOT_FINITE',
      field: `PK$ANNOTATION[${index}].mz`,
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): mz is not finite.`,
    });
  }
  if (row.exactMass !== undefined && !Number.isFinite(row.exactMass)) {
    errors.push({
      code: 'ANNOTATION_NOT_FINITE',
      field: `PK$ANNOTATION[${index}].exactMass`,
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): exactMass ${row.exactMass} is not finite.`,
    });
  }
  if (row.errorPpm !== undefined && !Number.isFinite(row.errorPpm)) {
    errors.push({
      code: 'ANNOTATION_NOT_FINITE',
      field: `PK$ANNOTATION[${index}].errorPpm`,
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): errorPpm ${row.errorPpm} is not finite.`,
    });
  }
  return errors;
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
 *
 * These four checks only run for a row that is actually about to be rebuilt
 * from these fields — never for one printing as its own `_original` text
 * (`preserveOriginals`, see the caller). That gate is currently unreachable
 * by construction for a genuinely unedited, parser-derived row: every shape
 * table-parsers.ts's 3-token branch can produce is one of the round-trip
 * cases above, never one of the four below, so a row that survived parsing
 * unedited can never trip them. Concretely, a value that LOOKS like it
 * should hit the fourth check below — an `annotation` that looks numeric,
 * e.g. `"100.25 5-methyl 194.08"` — never actually reaches this function
 * with that shape: the parser's own 3-token branch tests the same thing
 * first, via `Number.parseFloat`, and `Number.parseFloat('5-methyl')` is
 * `5` (not `NaN`), so it takes the "both remaining tokens numeric" path and
 * produces `{ mz: 100.25, exactMass: 5, errorPpm: 194.08 }` — `annotation`
 * is never set at all, and the fourth check below requires `annotation` to
 * be set. So this gate is not a dead check protecting nothing: it still
 * fires for a hand-built row a caller assembles directly (no `_original`,
 * so `preserveOriginals` is irrelevant to it) — only a *parsed, unedited*
 * row can never reach it, because the parser's own decision already ruled
 * out every shape that would trip it.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @returns a `BuildError` when the row cannot be serialized and reparsed as
 * itself
 */
function checkAnnotationShape(
  row: Annotation,
  index: number,
): BuildError | undefined {
  const { annotation, exactMass, errorPpm, mz } = row;
  const field = `PK$ANNOTATION[${index}]`;

  if (
    annotation === undefined &&
    exactMass !== undefined &&
    errorPpm === undefined
  ) {
    return {
      code: 'ANNOTATION_UNREPRESENTABLE',
      field,
      message: `PK$ANNOTATION row ${index} (mz ${mz}): exactMass is set without annotation or errorPpm. The parser reads a 2-token row as [mz, annotation] unconditionally, so this value would come back as annotation text, not exactMass.`,
    };
  }
  if (
    annotation === undefined &&
    exactMass === undefined &&
    errorPpm !== undefined
  ) {
    return {
      code: 'ANNOTATION_UNREPRESENTABLE',
      field,
      message: `PK$ANNOTATION row ${index} (mz ${mz}): errorPpm is set without annotation or exactMass. The parser reads a 2-token row as [mz, annotation] unconditionally, so this value would come back as annotation text, not errorPpm.`,
    };
  }
  if (
    annotation !== undefined &&
    exactMass === undefined &&
    errorPpm !== undefined
  ) {
    return {
      code: 'ANNOTATION_UNREPRESENTABLE',
      field,
      message: `PK$ANNOTATION row ${index} (mz ${mz}): errorPpm is set without exactMass. The parser has a 3-token recovery for [annotation, exactMass] and for [exactMass, errorPpm], but none for [annotation, errorPpm] — errorPpm would be misread as exactMass and annotation would be discarded.`,
    };
  }
  if (
    annotation !== undefined &&
    exactMass !== undefined &&
    errorPpm === undefined &&
    looksNumeric(annotation)
  ) {
    return {
      code: 'ANNOTATION_UNREPRESENTABLE',
      field,
      message: `PK$ANNOTATION row ${index} (mz ${mz}): annotation "${annotation}" looks numeric. The parser reads a 3-token [annotation, exactMass] row by testing whether both remaining tokens are numeric; a numeric-looking annotation is then misread as exactMass and the real exactMass is misread as errorPpm.`,
    };
  }
  return undefined;
}

/**
 * Run every PK$ANNOTATION row guard and collect every failure, rather than
 * stopping at the first — the guards are pure and independent of each
 * other's outcome.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @param preserveOriginals - true when no row in the table has been edited,
 * so this row's `_original` (if any) is being kept rather than discarded
 * @returns every `BuildError` this row fails, in guard order; empty when
 * the row is fully expressible
 */
function checkAnnotationRow(
  row: AnnotationWithOriginal,
  index: number,
  preserveOriginals: boolean,
): BuildError[] {
  const errors: BuildError[] = [];

  const discardedColumn = checkAnnotationDiscardedColumns(
    row,
    index,
    preserveOriginals,
  );
  if (discardedColumn) {
    errors.push(discardedColumn);
  }
  const roundTrippableText = checkAnnotationRoundTrippableText(row, index);
  if (roundTrippableText) {
    errors.push(roundTrippableText);
  }
  errors.push(...checkAnnotationFiniteValues(row, index));

  // A row printing as its own `_original` text is never rebuilt from these
  // fields, so the shape check below (which only protects a rebuild) cannot
  // apply — see checkAnnotationShape's docstring for why that gate is
  // unreachable for a genuinely unedited row regardless.
  if (row._original !== undefined && preserveOriginals) {
    return errors;
  }

  const shape = checkAnnotationShape(row, index);
  if (shape) {
    errors.push(shape);
  }
  return errors;
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
 * @returns a `BuildError` when `relativeIntensity` is not finite or is
 * negative
 */
function checkPeakRelativeIntensity(
  peak: Peak,
  index: number,
): BuildError | undefined {
  if (!Number.isFinite(peak.relativeIntensity) || peak.relativeIntensity < 0) {
    return {
      code: 'PEAK_INVALID_RELATIVE_INTENSITY',
      field: `PK$PEAK[${index}].relativeIntensity`,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): relativeIntensity ${peak.relativeIntensity} is not finite or is negative.`,
    };
  }
  return undefined;
}

/**
 * `calculate-splash.ts` rejects a non-finite `mz` but not a negative one —
 * `calculateHistogram`'s bin index is `Math.trunc(mz / binSize) % HISTOGRAM_BINS`,
 * and `Math.trunc` rounds a small negative quotient towards zero rather than
 * away from it, so e.g. `mz = -50` yields `Math.trunc(-0.5) === -0`, which
 * aliases bin 0 exactly like a real peak at `mz = 0..4` would. The resulting
 * SPLASH is computed and looks ordinary; it just silently misrepresents which
 * bin the peak actually falls in, so a negative `mz` cannot be left for
 * `calculateSplash` to catch — it must be rejected here, before any peak
 * reaches it.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns a `BuildError` when `mz` is negative
 */
function checkPeakMz(peak: Peak, index: number): BuildError | undefined {
  if (peak.mz < 0) {
    return {
      code: 'PEAK_NEGATIVE_MZ',
      field: `PK$PEAK[${index}].mz`,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): mz is negative. A negative m/z is not a real peak position, and calculateSplash's histogram bins by "Math.trunc(mz / binSize) % HISTOGRAM_BINS", which aliases a negative mz onto the same bin as a small non-negative one instead of rejecting it.`,
    };
  }
  return undefined;
}

/**
 * Run every PK$PEAK row guard and collect every failure, rather than
 * stopping at the first — `relativeIntensity` and `mz` are independent
 * facts about the same peak, so both can be wrong at once.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns every `BuildError` this peak fails; empty when it is valid
 */
function checkPeak(peak: Peak, index: number): BuildError[] {
  const errors: BuildError[] = [];
  const relativeIntensity = checkPeakRelativeIntensity(peak, index);
  if (relativeIntensity) {
    errors.push(relativeIntensity);
  }
  const mz = checkPeakMz(peak, index);
  if (mz) {
    errors.push(mz);
  }
  return errors;
}

/**
 * Every field record-serializer.ts writes verbatim into the output: a
 * single-value field on its own line, or each element of an array-valued
 * field on its own line each. `ACCESSION` is guarded separately in
 * `buildRecord` — it also derives `validateRecord`'s filename, but otherwise
 * now fails for exactly the same three reasons as the fields here (see
 * `checkVerbatimText`, which `checkAccession` mirrors under its own error
 * codes).
 *
 * parse-record.ts extracts a field's value with a single `.trim()`
 * (parse-record.ts:91), and `String.prototype.trim()` strips more than
 * plain spaces — tab, `\v`, `\f`, `\r`, `\n`, NBSP, EM SPACE, BOM, and every
 * other Unicode space separator. Leading or trailing whitespace of any of
 * those kinds is therefore silently dropped on reparse, never preserved. A
 * single-value field also disappears from the output entirely when its
 * value is the empty string, because record-serializer.ts guards every
 * VERBATIM_STRING_FIELDS write with `if (record.FIELD)`, and `''` is falsy
 * — checked as a separate rule from the whitespace one below, since
 * `''.trim() === ''` passes that check trivially. An array-valued field
 * element does NOT have the empty-string problem: record-serializer.ts's
 * truthiness check there guards the array itself, not each element, so an
 * empty-string element still gets its own `FIELD: ` line and reparses back
 * to `''` unchanged — `checkVerbatimText` allows it for array elements.
 *
 * A bare interior `\r` (no `\n` immediately after it) is, measured directly
 * against parse-record.ts, the one case that DOES reparse back to the
 * identical string at this layer: the line-splitting regex `/\r?\n/` only
 * treats `\r` as part of a line boundary when a `\n` immediately follows it,
 * and `.trim()` never touches a character in the middle of a string. It is
 * rejected here anyway, for a reason outside this file: `validateRecord`'s
 * `SerializationRule` normalises ANY `\r` — interior or not — to `\n` before
 * comparing (`originalText.replace(/\r\n?/g, '\n')`) but does not apply that
 * same normalisation to the freshly reserialized side, so a record
 * containing an interior `\r` is guaranteed to fail that rule every time it
 * is checked. Banning `\r` outright here, exactly like `\n`, matches how
 * `ACCESSION` has always treated it (see `checkAccession`, which never
 * allowed an interior `\r` either) and avoids handing back a record that
 * this library's own validator can never pass.
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

// Exported for tests only, so build-record.test.ts can drive its field
// sweeps from the same lists buildRecord actually iterates instead of a
// hand-copied duplicate that silently stops covering a field the moment
// these lists grow and the copy doesn't.
export { VERBATIM_ARRAY_FIELDS, VERBATIM_STRING_FIELDS };

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
 * ACCESSION is the one field `buildRecord` declares mandatory, and the field
 * `validateRecord` derives a filename from; `serializeRecord` writes it as
 * the first line verbatim. It fails for the same three reasons as the other
 * verbatim fields (see `checkVerbatimText`), just reported under its own
 * error codes and with ACCESSION-specific wording, since ACCESSION missing
 * or malformed is a different, more fundamental problem for a caller to
 * read than an ordinary field being unusable.
 * @param accession - the draft's `ACCESSION` value
 * @returns a `BuildError` when `accession` contains a newline or carriage
 * return (which would inject extra header lines into the serialized
 * record), is empty or whitespace-only (unreadable back — parseRecord
 * treats an empty ACCESSION as missing), or has leading or trailing
 * whitespace (trimmed away on reparse, so the reparsed value would differ
 * from the one supplied)
 */
function checkAccession(accession: string): BuildError | undefined {
  if (/[\n\r]/.test(accession)) {
    return {
      code: 'ACCESSION_LINE_INJECTION',
      field: 'ACCESSION',
      message: 'ACCESSION must not contain a newline or carriage return.',
    };
  }
  const trimmedAccession = accession.trim();
  if (trimmedAccession.length === 0) {
    return {
      code: 'ACCESSION_EMPTY',
      field: 'ACCESSION',
      message:
        'ACCESSION must not be empty or whitespace-only — parseRecord treats an empty ACCESSION as missing and throws "ACCESSION field is required" on reparse.',
    };
  }
  if (trimmedAccession !== accession) {
    return {
      code: 'ACCESSION_WHITESPACE',
      field: 'ACCESSION',
      message:
        'ACCESSION must not have leading or trailing whitespace — parseRecord trims it on reparse, so the reparsed value would differ from the one supplied.',
    };
  }
  return undefined;
}

/**
 * Check a draft-supplied value the serializer would write verbatim, against
 * the round-trip invariant this whole guard exists for: a value written
 * verbatim must reparse back to the identical string. See the comment above
 * `VERBATIM_STRING_FIELDS` for how each of the three checks below was
 * derived and measured against parse-record.ts and record-serializer.ts.
 * @param fieldName - the field (or `field[index]` for an array element)
 * being checked, for error reporting
 * @param value - the draft-supplied string that will be written verbatim
 * @param allowEmpty - true for an array element (an empty string round-trips
 * fine there); false for a single-value field (an empty string makes the
 * whole field vanish on reparse)
 * @returns a `BuildError` when `value` contains a newline or carriage
 * return, is empty while `allowEmpty` is false, or has leading or trailing
 * whitespace of any kind `String.prototype.trim()` strips
 */
function checkVerbatimText(
  fieldName: string,
  value: string,
  allowEmpty: boolean,
): BuildError | undefined {
  if (/[\n\r]/.test(value)) {
    return {
      code: 'VERBATIM_LINE_INJECTION',
      field: fieldName,
      message: `${fieldName} must not contain a newline or carriage return. It is written verbatim into the output: a newline would inject the text that follows it as forged lines once the record is reparsed; a carriage return reparses back to the same string at this layer but is guaranteed to fail validateRecord's serialization round-trip rule, so it is rejected here too.`,
    };
  }
  if (!allowEmpty && value.length === 0) {
    return {
      code: 'VERBATIM_EMPTY',
      field: fieldName,
      message: `${fieldName} must not be empty — record-serializer.ts only writes this field when it is truthy, so an empty string would vanish from the output entirely instead of round-tripping.`,
    };
  }
  if (value.trim() !== value) {
    return {
      code: 'VERBATIM_WHITESPACE',
      field: fieldName,
      message: `${fieldName} must not have leading or trailing whitespace — parse-record.ts trims the value after the colon on reparse, so the reparsed value would differ from the one supplied.`,
    };
  }
  return undefined;
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
 *
 * Every guard below is pure and independent of the others' outcome, so all
 * of them run and every failure is collected before anything throws —
 * fixing one problem at a time across repeated calls is not required. Only
 * once every guard has passed does this function touch `calculateSplash` or
 * build the returned record; a draft with any guard failure never reaches
 * that construction step.
 * @param draft - the record draft to canonicalise
 * @returns the canonicalised record
 * @throws {BuildException} when one or more guards fail: `ACCESSION` is
 * missing, empty, whitespace-padded, or contains a newline/carriage return
 * (see `checkAccession`); any other field record-serializer.ts writes
 * verbatim (or an element of an array-valued one) is empty (single-value
 * fields only), whitespace-padded, or contains a newline/carriage return
 * (see `checkVerbatimText`, {@link VERBATIM_STRING_FIELDS}, and
 * {@link VERBATIM_ARRAY_FIELDS} for the full field list); a peak's
 * `relativeIntensity` is not finite or is negative, or a peak's `mz` is
 * negative (see `checkPeakRelativeIntensity`/`checkPeakMz` — a negative
 * `mz` is rejected here rather than left for `calculateSplash`, because
 * `calculateSplash`'s histogram binning silently aliases a small negative
 * `mz` onto the same bin as a small non-negative one instead of rejecting
 * it); or a PK$ANNOTATION row cannot survive a round-trip — the parser did
 * not map every token of the row's source text into a typed field, its
 * `annotation` is empty/whitespace-only/contains internal whitespace, its
 * `mz`/`exactMass`/`errorPpm` is not finite, or the combination of optional
 * fields it sets cannot be expressed in the token-count format (see
 * `checkAnnotationRow` and the functions it calls for the full legal/illegal
 * table and why it is not simply "a prefix of
 * `[annotation, exactMass, errorPpm]`"). `error.buildErrors` carries every
 * failure found, each with a machine-readable `code` and the `field` (or
 * `table[index]`/`table[index].field`) it came from — see
 * {@link BuildException}.
 * @throws {RangeError} when the peak list is non-empty but cannot be hashed —
 * all-zero intensity, a negative intensity, or a non-finite `mz`/`intensity`.
 * An empty peak list is dropped rather than hashed, so it never reaches this
 * error. This comes from `calculateSplash` itself, after every guard above
 * has already passed, so it is not part of `BuildException`. Note
 * SplashRule swallows the same error; the builder does not, because such a
 * spectrum is not publishable.
 */
export async function buildRecord(draft: RecordDraft): Promise<InternalRecord> {
  const errors: BuildError[] = [];

  const accessionError = checkAccession(draft.ACCESSION);
  if (accessionError) {
    errors.push(accessionError);
  }

  for (const field of VERBATIM_STRING_FIELDS) {
    const value = draft[field];
    if (value !== undefined) {
      const error = checkVerbatimText(field, value, false);
      if (error) {
        errors.push(error);
      }
    }
  }
  for (const field of VERBATIM_ARRAY_FIELDS) {
    const values = draft[field];
    if (values !== undefined) {
      for (const [index, value] of values.entries()) {
        const error = checkVerbatimText(`${field}[${index}]`, value, true);
        if (error) {
          errors.push(error);
        }
      }
    }
  }

  const peaks = draft.PK$PEAK;
  if (peaks !== undefined) {
    for (const [index, peak] of peaks.entries()) {
      errors.push(...checkPeak(peak, index));
    }
  }

  const annotations = draft.PK$ANNOTATION;
  // All-or-nothing per table, not per row: a table's `_PK$ANNOTATION_HEADER`
  // is shared by every row in it, so it can only be kept or dropped as a
  // unit. The moment any row has been edited, every row's `_original` is
  // discarded and the row is rebuilt from typed fields instead — including
  // rows that themselves were never touched, because a row whose real
  // source column count wouldn't survive that rebuild must still be
  // refused (checkAnnotationDiscardedColumns), and a mix of "printed
  // verbatim" and "rebuilt" rows under one shared header would be
  // inconsistent regardless.
  const preserveOriginals =
    annotations !== undefined &&
    !annotations.some((row) => wasAnnotationRowEdited(row));
  if (annotations !== undefined) {
    for (const [index, row] of annotations.entries()) {
      errors.push(...checkAnnotationRow(row, index, preserveOriginals));
    }
  }

  if (errors.length > 0) {
    throw new BuildException(errors);
  }

  const record: InternalRecord = { ...draft };

  if (peaks !== undefined && peaks.length > 0) {
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

  if (annotations !== undefined && annotations.length > 0) {
    record.PK$ANNOTATION = annotations
      .map((a: AnnotationWithOriginal) => ({
        mz: a.mz,
        ...(a.annotation === undefined ? {} : { annotation: a.annotation }),
        ...(a.exactMass === undefined ? {} : { exactMass: a.exactMass }),
        ...(a.errorPpm === undefined ? {} : { errorPpm: a.errorPpm }),
        ...(preserveOriginals && a._original !== undefined
          ? { _original: a._original }
          : {}),
      }))
      .toSorted((a, b) => a.mz - b.mz);
    if (preserveOriginals) {
      // Keep whatever header the draft carried in (a parsed InternalRecord
      // passed straight through — RecordDraft's Omit only blocks object
      // literals, not variables) so the preserved rows print under the
      // header they actually belong to, not buildRecord's default.
    } else {
      // buildRecord is about to emit fresh rows rebuilt from typed fields
      // under its own canonical header, so a header carried in from a
      // parsed InternalRecord must not survive — otherwise the serializer
      // would print the rebuilt rows under a header describing the old ones.
      delete record._PK$ANNOTATION_HEADER;
    }
  } else {
    // Keep the canonical shape empty-table-free, matching the PK$NUM_PEAK
    // and PK$SPLASH deletes above rather than carrying an empty array.
    delete record.PK$ANNOTATION;
    delete record._PK$ANNOTATION_HEADER;
  }

  return record;
}
