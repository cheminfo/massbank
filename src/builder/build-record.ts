import type { AnnotationColumn } from '../parser/annotation-columns.ts';
import {
  annotationColumnValue,
  deriveAnnotationHeader,
  mapAnnotationHeader,
} from '../parser/annotation-columns.ts';
import { parseRecord } from '../parser/parse-record.ts';
import type {
  Annotation,
  AnnotationWithOriginal,
  MassBankRecord,
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
// MassBankRecord straight through and its rows/header arrive with
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
  Omit<MassBankRecord, 'PK$PEAK' | 'PK$ANNOTATION' | '_PK$ANNOTATION_HEADER'>
> & {
  ACCESSION: string;
  PK$PEAK?: Peak[];
  PK$ANNOTATION?: Annotation[];
};

/**
 * Build the four location fields every `BuildError` carries — the
 * pre-formatted display string (`field`) plus the three structured parts a
 * caller can route on without parsing it (`fieldName`/`rowIndex`/
 * `property`) — from one place, so `field`'s shape can never drift from the
 * parts it is built from.
 * @param fieldName - the top-level `RecordDraft` key the failure is about
 * @param rowIndex - the row's (or array element's) position in the draft,
 * when the failure is about one row/element rather than the whole field —
 * see {@link BuildError.rowIndex} for why this is draft order, not output
 * order
 * @param property - the row's specific property, when the failure concerns
 * one property rather than the whole row/element
 * @returns the four fields to spread into a `BuildError`
 */
function describeField(
  fieldName: string,
  rowIndex?: number,
  property?: string,
): Pick<BuildError, 'field' | 'fieldName' | 'property' | 'rowIndex'> {
  const field =
    rowIndex === undefined
      ? fieldName
      : property === undefined
        ? `${fieldName}[${rowIndex}]`
        : `${fieldName}[${rowIndex}].${property}`;
  return {
    field,
    fieldName,
    ...(rowIndex === undefined ? {} : { rowIndex }),
    ...(property === undefined ? {} : { property }),
  };
}

/**
 * Outcome of reparsing a single PK$ANNOTATION row's `_original` source text
 * in isolation, via `reparseAnnotationOriginal`.
 */
interface AnnotationOriginalReparse {
  /**
   * What the parser produces from `_original` today, or `undefined` if it
   * drops the line entirely (e.g. a non-numeric first token). Only
   * meaningful when `error` is absent.
   */
  annotation: Annotation | undefined;
  /**
   * Set when `_original` cannot be trusted to print verbatim at all —
   * see `reparseAnnotationOriginal` for the three cases this covers.
   * `annotation` is always `undefined` alongside this.
   */
  error?: BuildError;
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
 * table produced, PROVIDED `original` really is a single line and really is
 * safe to feed back through `parseRecord` — which is exactly what the three
 * checks below confirm before any of the result is trusted:
 *
 * - A newline or carriage return in `original` would print as more than one
 *   physical line once `_original` is written verbatim
 *   (`  ${original}` in record-serializer.ts) — forging extra annotation
 *   rows, or, if the injected line itself looks like `KEY: value`, a forged
 *   header field. Rejected outright, before any reparse is attempted.
 * - Even a single line is not guaranteed to just drop or misparse as an
 *   annotation row: a line that looks like `KEY: value` for a real header
 *   key (e.g. `PK$NUM_PEAK: notanumber`) ends the mini annotation table
 *   early (table-parsers.ts's `startsNewField`) and is reparsed as that
 *   header field instead — which can itself throw (`PeakFieldParser`
 *   rejects a non-numeric `PK$NUM_PEAK`). That throw must not escape
 *   `buildRecord` uncaught: it is caught here and reported as a
 *   `BuildError` instead, so one poisoned row cannot abort validation
 *   before every other guard has had a chance to run — and so it cannot
 *   swallow an unrelated failure (e.g. a bad ACCESSION) that would
 *   otherwise have been collected alongside it.
 * - Reparsing is expected to produce exactly one annotation row. More than
 *   one is unreachable once the newline check above holds — a single
 *   physical line can only ever contribute one row — but is still checked
 *   directly rather than assumed, in case that stops being true.
 * @param original - a row's `_original` source text
 * @param index - the row's position in the draft, for error reporting
 * @param mz - the row's `mz`, for error reporting
 * @returns the annotation the parser produces from `original` today (or
 * `undefined` if it drops the line entirely), or a `BuildError` when
 * `original` cannot be trusted to reparse safely at all
 */
function reparseAnnotationOriginal(
  original: string,
  index: number,
  mz: number,
  header: string,
): AnnotationOriginalReparse {
  const location = describeField('PK$ANNOTATION', index, '_original');

  if (/[\n\r]/.test(original)) {
    return {
      annotation: undefined,
      error: {
        code: 'ANNOTATION_ORIGINAL_LINE_INJECTION',
        ...location,
        message: `PK$ANNOTATION row ${index} (mz ${mz}): _original must not contain a newline or carriage return. It is written verbatim into the output when the table round-trips unedited, so a newline would inject the text that follows it as forged annotation rows, or — if the injected text itself looks like "KEY: value" — as a forged header field, once the record is reparsed.`,
      },
    };
  }

  let parsed: MassBankRecord;
  try {
    parsed = parseRecord(
      `ACCESSION: reparse-check\nPK$ANNOTATION: ${header}\n  ${original}\n//\n`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      annotation: undefined,
      error: {
        code: 'ANNOTATION_ORIGINAL_UNREADABLE',
        ...location,
        message: `PK$ANNOTATION row ${index} (mz ${mz}): _original could not be confirmed safe to preserve — reparsing it in isolation threw "${reason}" instead of producing a row.`,
      },
    };
  }

  const rows = parsed.PK$ANNOTATION ?? [];
  if (rows.length > 1) {
    return {
      annotation: undefined,
      error: {
        code: 'ANNOTATION_ORIGINAL_UNREADABLE',
        ...location,
        message: `PK$ANNOTATION row ${index} (mz ${mz}): _original could not be confirmed safe to preserve — reparsing it in isolation produced ${rows.length} annotation rows instead of exactly 1.`,
      },
    };
  }

  return { annotation: rows[0] };
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
 * and is therefore never itself "edited" by this definition. That alone does
 * NOT make it eligible for table-wide preservation, though — see
 * `buildRecord`'s `preservedRows`, which additionally requires the row to
 * carry an `_original` at all.
 *
 * When `_original` cannot be confirmed safe to reparse at all — see
 * `reparseAnnotationOriginal` for the three cases — this reports the row as
 * edited, so it is never trusted to print verbatim, AND returns the
 * `BuildError` that caused that, rather than letting the underlying
 * exception escape `buildRecord` uncaught.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @returns `edited: true` when `row`'s typed fields diverge from a reparse
 * of its own `_original`, or when that reparse could not be trusted at all
 * (`error` is then set); `edited: false` when there is no `_original` to
 * compare, or the reparse confirms the row is unchanged
 */
function wasAnnotationRowEdited(
  row: AnnotationWithOriginal,
  index: number,
  header: string,
): { edited: boolean; error?: BuildError } {
  if (row._original === undefined) {
    return { edited: false };
  }
  const reparse = reparseAnnotationOriginal(
    row._original,
    index,
    row.mz,
    header,
  );
  if (reparse.error) {
    return { edited: true, error: reparse.error };
  }
  return { edited: !annotationTypedFieldsMatch(row, reparse.annotation) };
}

/**
 * `mz`, `exactMass`, and `errorPpm` are rejected when non-finite because none
 * of them are physical quantities as `NaN` or `Infinity`, and MassBank's text
 * format has no representation for either — not because the parser is
 * guaranteed to lose them. The actual reparse behaviour varies: `NaN` for
 * `mz` does make the parser bail on that token and drop the whole row, but
 * `Infinity` for `mz` reparses fine (`Number.parseFloat('Infinity')` is
 * `Infinity`, so the row survives), and `Infinity` in a mapped
 * `exactMass`/`errorPpm` column survives too — `assignByHeader` only skips a
 * token that parses to `NaN`.
 *
 * Unlike the header-order guards below, this one runs for EVERY row, including
 * one printing as its own `_original`. A preserved row with `Infinity` in a
 * numeric column round-trips perfectly well; it is refused anyway, because the
 * objection is to the value being in a MassBank record at all, not to it
 * surviving the trip.
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
      ...describeField('PK$ANNOTATION', index, 'mz'),
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): mz is not finite.`,
    });
  }
  if (row.exactMass !== undefined && !Number.isFinite(row.exactMass)) {
    errors.push({
      code: 'ANNOTATION_NOT_FINITE',
      ...describeField('PK$ANNOTATION', index, 'exactMass'),
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): exactMass ${row.exactMass} is not finite.`,
    });
  }
  if (row.errorPpm !== undefined && !Number.isFinite(row.errorPpm)) {
    errors.push({
      code: 'ANNOTATION_NOT_FINITE',
      ...describeField('PK$ANNOTATION', index, 'errorPpm'),
      message: `PK$ANNOTATION row ${index} (mz ${row.mz}): errorPpm ${row.errorPpm} is not finite.`,
    });
  }
  return errors;
}

/**
 * One header column paired with the text the row puts in it — `undefined` when
 * the row leaves that column empty. Both header-order guards below read this,
 * and it is produced by `annotationColumnValue`, the same function the
 * serializer prints from, so a guard can never disagree with the writer about
 * what a column is worth.
 */
interface AnnotationCell {
  column: AnnotationColumn;
  value: string | undefined;
}

/**
 * Pair every column of the header a row will be emitted under with that row's
 * value for it.
 * @param row - the annotation row about to be rebuilt
 * @param columns - the mapped header the row will be printed under, in order
 * @returns one cell per header column, in header order
 */
function annotationCells(
  row: Annotation,
  columns: AnnotationColumn[],
): AnnotationCell[] {
  return columns.map((column) => ({
    column,
    value: annotationColumnValue(row, column),
  }));
}

/**
 * Whether a cell contributes a token to the emitted row. The serializer stops
 * at the first column with no value AND at the first empty one
 * (record-serializer.ts breaks on `undefined` or `''`), so an empty string is
 * an absent column, not a blank token.
 * @param cell - the cell to test
 * @returns true when the column is printed
 */
function isFilled(cell: AnnotationCell): boolean {
  return cell.value !== undefined && cell.value !== '';
}

/**
 * A row may not populate a column while an earlier one is absent.
 *
 * This is `ANNOTATION_EXACT_MASS_WITHOUT_ANNOTATION` and its two siblings,
 * generalised: they were the same rule written out against the old fixed
 * `[mz, annotation, exact_mass, error(ppm)]` order, at a time when the parser
 * inferred that order from the token count. The parser now reads the record's
 * own header, so the rule has to be expressed against that header instead —
 * and the same combination is legal under one header and illegal under
 * another. `{mz, exactMass}` under `m/z exact_mass` is a clean two-token row;
 * under `m/z annotation exact_mass` it is a hole.
 *
 * A hole cannot be printed: MassBank documents no placeholder for an absent
 * middle column and the corpus contains no example, so inventing one would be
 * fabrication. Emitting the later columns anyway would shift them left and
 * have them reparse as the wrong field — the corruption this release removes,
 * reintroduced by the fix. `serializeAnnotationByHeader` therefore stops at
 * the hole, which silently drops everything after it; this guard refuses the
 * row before that can happen.
 *
 * Reachable by ordinary editing, not just by hand-assembling a draft: with the
 * corpus header `m/z tentative_formula formula_count mass error(ppm)`, clearing
 * `mass` while keeping `error(ppm)` produces exactly this shape.
 * @param cells - the row's cells, in header order
 * @param row - the annotation row, for error reporting
 * @param index - the row's position in the draft, for error reporting
 * @returns a `BuildError` naming the hole and the column stranded after it
 */
function checkAnnotationColumnGap(
  cells: AnnotationCell[],
  row: Annotation,
  index: number,
): BuildError | undefined {
  const holeIndex = cells.findIndex((cell) => !isFilled(cell));
  if (holeIndex === -1) {
    return undefined;
  }
  const stranded = cells.slice(holeIndex + 1).find(isFilled);
  if (stranded === undefined) {
    return undefined;
  }
  const hole = cells[holeIndex];
  return {
    code: 'ANNOTATION_COLUMN_GAP',
    ...describeField('PK$ANNOTATION', index),
    message: `PK$ANNOTATION row ${index} (mz ${row.mz}): column "${hole?.column.token}" is empty but the later column "${stranded.column.token}" is not. A row must fill an unbroken prefix of its header — there is no placeholder for an absent middle column, so the writer stops at the hole and everything after it is dropped.`,
  };
}

/**
 * Every text column a row fills must come back as the same string, at the same
 * column, when the row is reparsed.
 *
 * Rows are whitespace-delimited (`table-parsers.ts` splits on `/\s+/`), so:
 *
 * - An empty value is not a blank token — the writer treats it as an absent
 *   column, so the value is simply lost.
 * - Leading or trailing whitespace does not change the token count (the
 *   parser's `line.trim()` absorbs it) but is trimmed away on reparse, so the
 *   value that comes back differs from the one supplied.
 * - Internal whitespace splits one value into several tokens, which land in
 *   several columns — EXCEPT in the final header column, where
 *   `assignByHeader` joins every surplus token back into it. A multi-word
 *   value there survives, provided its words are separated by single spaces:
 *   the join reassembles them with exactly one space each, so `"a  b"` comes
 *   back as `"a b"`.
 *
 * Numeric columns are exempt because their text is produced by
 * `Number.prototype.toString()` and can never contain whitespace. `extra`
 * columns are not exempt: they are caller-supplied strings exactly like
 * `annotation`, and were unguarded before this release only because they did
 * not exist.
 * @param cells - the row's cells, in header order
 * @param row - the annotation row, for error reporting
 * @param index - the row's position in the draft, for error reporting
 * @returns one `BuildError` per column whose text cannot survive the trip
 */
function checkAnnotationColumnText(
  cells: AnnotationCell[],
  row: Annotation,
  index: number,
): BuildError[] {
  const errors: BuildError[] = [];
  const lastIndex = cells.length - 1;

  for (const [position, cell] of cells.entries()) {
    const { value } = cell;
    const isTextColumn =
      cell.column.field === 'annotation' || cell.column.field === null;
    if (value === undefined || !isTextColumn) {
      continue;
    }
    const property =
      cell.column.field === 'annotation'
        ? 'annotation'
        : `extra.${cell.column.token}`;
    const problem = describeAnnotationTextProblem(
      value,
      position === lastIndex,
    );
    if (problem !== undefined) {
      errors.push({
        code: 'ANNOTATION_TEXT_NOT_ROUND_TRIPPABLE',
        ...describeField('PK$ANNOTATION', index, property),
        message: `PK$ANNOTATION row ${index} (mz ${row.mz}): column "${cell.column.token}" value ${JSON.stringify(value)} ${problem}`,
      });
    }
  }

  return errors;
}

/**
 * Why a text column's value cannot survive a reparse, or `undefined` when it
 * can. Split out from `checkAnnotationColumnText` so each cause states its own
 * remedy — one shared "unrepresentable" sentence would leave a caller guessing
 * which of four different edits to make.
 * @param value - the column's text
 * @param isFinalColumn - whether this is the last column of the header, the
 * only one `assignByHeader` rejoins surplus tokens into
 * @returns the sentence completing "value <...>", or `undefined` when the
 * value round-trips
 */
function describeAnnotationTextProblem(
  value: string,
  isFinalColumn: boolean,
): string | undefined {
  if (value.length === 0) {
    return 'is empty. An empty column is not printed as a blank token — the writer treats it as absent, so the value is lost.';
  }
  if (value.trim() !== value) {
    return 'has leading or trailing whitespace, which the parser trims on reparse, so the value that comes back differs from the one supplied.';
  }
  if (!/\s/.test(value)) {
    return undefined;
  }
  if (!isFinalColumn) {
    return 'contains internal whitespace and is not in the final header column. It would split into several tokens and land in several columns.';
  }
  if (value.split(/\s+/).join(' ') !== value) {
    return 'contains internal whitespace that is not a single space. The final column rejoins its surplus tokens with exactly one space each, so the value that comes back differs from the one supplied.';
  }
  return undefined;
}

/**
 * Refuse to rebuild a row under a header the parser cannot read positionally.
 *
 * `mapAnnotationHeader` returns `null` for a header that does not begin with
 * the m/z, or that maps two columns onto one field. Under such a header the
 * serializer falls back to emitting by field presence and the parser falls
 * back to guessing from the token count — the two independent inferences whose
 * disagreement is this release's entire subject. Rather than reinstate the old
 * token-count guard suite for that one case, `buildRecord` declines to rebuild
 * at all: refusing can lose nothing, and a record whose rows are all unedited
 * still round-trips, because every row prints as its own `_original`.
 * @param header - the header the row would be emitted under
 * @param row - the annotation row, for error reporting
 * @param index - the row's position in the draft, for error reporting
 * @returns the `BuildError` to report for this row
 */
function annotationHeaderNotMappable(
  header: string,
  row: Annotation,
  index: number,
): BuildError {
  return {
    code: 'ANNOTATION_HEADER_NOT_MAPPABLE',
    ...describeField('PK$ANNOTATION', index),
    message: `PK$ANNOTATION row ${index} (mz ${row.mz}): the table's header ${JSON.stringify(header)} cannot be read positionally — it must begin with the m/z column and must not name the same field twice — so a rebuilt row cannot be placed in it. An unedited row is unaffected: it prints as its own source text.`,
  };
}

/**
 * Run every guard that applies to a row being REBUILT from its typed fields.
 * A row printing as its own `_original` skips all of them: whatever the parser
 * read out of that text is by definition what the text reparses to, so its
 * round-trip needs no proving.
 * @param row - the annotation row to check
 * @param index - the row's position in the draft, for error reporting
 * @param header - the header value the row will be emitted under
 * @param columns - that header mapped, or `null` when it cannot be read
 * positionally
 * @returns every `BuildError` this row fails; empty when it is expressible
 */
function checkAnnotationRebuild(
  row: Annotation,
  index: number,
  header: string,
  columns: AnnotationColumn[] | null,
): BuildError[] {
  if (columns === null) {
    return [annotationHeaderNotMappable(header, row, index)];
  }
  const cells = annotationCells(row, columns);
  const gap = checkAnnotationColumnGap(cells, row, index);
  return [
    ...(gap === undefined ? [] : [gap]),
    ...checkAnnotationColumnText(cells, row, index),
  ];
}

/**
 * Read `_PK$ANNOTATION_HEADER` off a draft despite `RecordDraft`'s type
 * omitting that key entirely (see the module comment on `RecordDraft`) — a
 * caller can still pass a parsed `MassBankRecord` through as a plain
 * variable, and it arrives with `_PK$ANNOTATION_HEADER` intact at runtime
 * regardless of what the type says. `draft[field]` in the generic
 * `VERBATIM_STRING_FIELDS` sweep below (inside `buildRecord`) cannot reach
 * this key at all — TypeScript rejects indexing a `RecordDraft` with a key
 * `Omit` removed from it — which is exactly why this field needs its own
 * accessor instead of joining that sweep.
 * @param draft - the record draft to read from
 * @returns the smuggled `_PK$ANNOTATION_HEADER` value, or `undefined` if the
 * draft never carried one
 */
function readAnnotationHeader(draft: RecordDraft): string | undefined {
  return (draft as { _PK$ANNOTATION_HEADER?: string })._PK$ANNOTATION_HEADER;
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
 * Reported as two separate codes — not finite vs. negative — since they are
 * different problems with different fixes, even though both concern the same
 * field: `Number.NaN`/`Infinity` need an entirely different value, where a
 * finite negative reading may only need its sign corrected.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns every `BuildError` `relativeIntensity` fails — up to two, since
 * not-finite and negative are independent facts about the same value (e.g.
 * `-Infinity` is both)
 */
function checkPeakRelativeIntensity(peak: Peak, index: number): BuildError[] {
  const errors: BuildError[] = [];
  const location = describeField('PK$PEAK', index, 'relativeIntensity');
  if (!Number.isFinite(peak.relativeIntensity)) {
    errors.push({
      code: 'PEAK_RELATIVE_INTENSITY_NOT_FINITE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): relativeIntensity ${peak.relativeIntensity} is not finite.`,
    });
  }
  if (peak.relativeIntensity < 0) {
    errors.push({
      code: 'PEAK_RELATIVE_INTENSITY_NEGATIVE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): relativeIntensity ${peak.relativeIntensity} is negative.`,
    });
  }
  return errors;
}

/**
 * `calculate-splash.ts` itself rejects a non-finite `mz` (see
 * `checkPeakIntensity`'s docstring for that half of the fold), but NOT a
 * negative one — `calculateHistogram`'s bin index is
 * `Math.trunc(mz / binSize) % HISTOGRAM_BINS`, and `Math.trunc` rounds a
 * small negative quotient towards zero rather than away from it, so e.g.
 * `mz = -50` yields `Math.trunc(-0.5) === -0`, which aliases bin 0 exactly
 * like a real peak at `mz = 0..4` would. The resulting SPLASH is computed and
 * looks ordinary; it just silently misrepresents which bin the peak actually
 * falls in. This is the one peak-hashability condition that is NOT simply
 * reused from `calculateSplash` (contrast `checkPeakIntensity`): `mz < 0`
 * must be rejected here regardless of what `calculateSplash` does with it,
 * because what it does with it is wrong.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns every `BuildError` `mz` fails — up to two, since not-finite and
 * negative are independent facts about the same value
 */
function checkPeakMz(peak: Peak, index: number): BuildError[] {
  const errors: BuildError[] = [];
  const location = describeField('PK$PEAK', index, 'mz');
  if (!Number.isFinite(peak.mz)) {
    errors.push({
      code: 'PEAK_MZ_NOT_FINITE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): mz is not finite. calculateSplash refuses to hash a non-finite mz; this guard reports it as a BuildError instead of letting that RangeError escape.`,
    });
  }
  if (peak.mz < 0) {
    errors.push({
      code: 'PEAK_MZ_NEGATIVE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): mz is negative. A negative m/z is not a real peak position, and calculateSplash's histogram bins by "Math.trunc(mz / binSize) % HISTOGRAM_BINS", which aliases a negative mz onto the same bin as a small non-negative one instead of rejecting it.`,
    });
  }
  return errors;
}

/**
 * `intensity` — unlike `relativeIntensity` — feeds `calculateSplash`
 * directly (`SplashPeak` is `{mz, intensity}`), which already refuses to
 * hash a non-finite or negative one, throwing a plain `RangeError`. Left
 * unguarded, that `RangeError` would reach a `buildRecord` caller separately
 * from every other failure, alongside `BuildException` from one entry point
 * — two exception types for what is, from a caller's seat, the same kind of
 * problem: bad peak data.
 *
 * Reusing `calculateSplash`'s own decision (rather than reimplementing an
 * independent check that could drift out of sync with it) is deliberate:
 * unlike `checkPeakMz`'s negative-`mz` case, `calculateSplash`'s finiteness
 * and non-negativity checks on `intensity` are not wrong, so there is no
 * reason to duplicate the reasoning, only the trigger condition. The
 * `it.each` sweep in build-record.test.ts's "peak-hashability guards match
 * calculateSplash" describe block runs both this guard and the real
 * `calculateSplash` over the same generated peaks and asserts they agree on
 * every case, so a future change to either side that breaks the
 * correspondence fails a test instead of leaving `buildRecord` quietly
 * wrong.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns every `BuildError` `intensity` fails — up to two, since
 * not-finite and negative are independent facts about the same value
 */
function checkPeakIntensity(peak: Peak, index: number): BuildError[] {
  const errors: BuildError[] = [];
  const location = describeField('PK$PEAK', index, 'intensity');
  if (!Number.isFinite(peak.intensity)) {
    errors.push({
      code: 'PEAK_INTENSITY_NOT_FINITE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): intensity ${peak.intensity} is not finite. calculateSplash refuses to hash a non-finite intensity; this guard reports it as a BuildError instead of letting that RangeError escape.`,
    });
  }
  if (peak.intensity < 0) {
    errors.push({
      code: 'PEAK_INTENSITY_NEGATIVE',
      ...location,
      message: `PK$PEAK row ${index} (mz ${peak.mz}): intensity ${peak.intensity} is negative. calculateSplash refuses to hash a negative intensity; this guard reports it as a BuildError instead of letting that RangeError escape.`,
    });
  }
  return errors;
}

/**
 * The one peak-hashability condition `checkPeakIntensity`/`checkPeakMz`
 * cannot see per-row: `calculateSplash` also refuses a peak list whose
 * highest intensity is `0` (every peak reads as silence — there is no base
 * peak to normalise against). By the time this runs, `checkPeakIntensity`
 * has already ruled out a negative intensity, so "the highest is 0" and
 * "every intensity is exactly 0" are the same fact.
 * @param peaks - every peak in the draft
 * @returns a `BuildError` when `peaks` is non-empty and every intensity is 0
 */
function checkPeakTableAllZeroIntensity(peaks: Peak[]): BuildError | undefined {
  if (peaks.length === 0 || !peaks.every((peak) => peak.intensity === 0)) {
    return undefined;
  }
  return {
    code: 'PEAK_ALL_ZERO_INTENSITY',
    ...describeField('PK$PEAK'),
    message:
      'PK$PEAK: every peak has intensity 0. calculateSplash refuses to hash an all-zero-intensity spectrum — there is no base peak to normalise against.',
  };
}

/**
 * Run every PK$PEAK row guard and collect every failure, rather than
 * stopping at the first — `relativeIntensity`, `mz`, and `intensity` are
 * independent facts about the same peak, so more than one can be wrong at
 * once.
 * @param peak - the peak to check
 * @param index - the peak's position in the draft, for error reporting
 * @returns every `BuildError` this peak fails; empty when it is valid
 */
function checkPeak(peak: Peak, index: number): BuildError[] {
  return [
    ...checkPeakRelativeIntensity(peak, index),
    ...checkPeakMz(peak, index),
    ...checkPeakIntensity(peak, index),
  ];
}

/**
 * Every field record-serializer.ts writes verbatim into the output: a
 * single-value field on its own line, or each element of an array-valued
 * field on its own line each. `ACCESSION` is guarded separately in
 * `buildRecord`, under its own error codes — it also derives
 * `validateRecord`'s filename and, unlike the fields here, is mandatory, so
 * `checkAccession` still rejects an empty value; the fields here do not (see
 * below).
 *
 * parse-record.ts extracts a field's value with a single `.trim()`
 * (parse-record.ts:91), and `String.prototype.trim()` strips more than
 * plain spaces — tab, `\v`, `\f`, `\r`, `\n`, NBSP, EM SPACE, BOM, and every
 * other Unicode space separator. Leading or trailing whitespace of any of
 * those kinds is therefore silently dropped on reparse, never preserved.
 *
 * An empty single-value field is NOT rejected here — `checkVerbatimText` has
 * no opinion on emptiness at all. record-serializer.ts guards every
 * VERBATIM_STRING_FIELDS write with `if (record.FIELD)`, and `''` is falsy,
 * so an empty value would vanish from the output regardless of what
 * `buildRecord` does with it; `buildRecord` leans into that rather than
 * fighting it, and canonicalises an empty single-value field to absent (see
 * where `VERBATIM_STRING_FIELDS` is swept after `record` is built) instead
 * of refusing a draft the parser itself produces without complaint for
 * input like `RECORD_TITLE: ` — rejecting that would make `buildRecord`
 * strictly less capable than `parseRecord`, the same defect the
 * `_original`-preservation rule (see `preservedRows`) avoids on the
 * PK$ANNOTATION side.
 * An array-valued field element is unaffected either way: record-serializer.ts's
 * truthiness check there guards the array itself, not each element, so an
 * empty-string element already gets its own `FIELD: ` line and reparses back
 * to `''` unchanged — there was never anything to canonicalise for arrays.
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
] as const satisfies ReadonlyArray<keyof MassBankRecord>;

const VERBATIM_ARRAY_FIELDS = [
  'COMMENT',
  'CH$NAME',
  'CH$LINK',
  'AC$MASS_SPECTROMETRY',
  'AC$CHROMATOGRAPHY',
  'MS$FOCUSED_ION',
  'MS$DATA_PROCESSING',
  'SP$LINK',
] as const satisfies ReadonlyArray<keyof MassBankRecord>;

// Exported for tests only, so build-record.test.ts can drive its field
// sweeps from the same lists buildRecord actually iterates instead of a
// hand-copied duplicate that silently stops covering a field the moment
// these lists grow and the copy doesn't.
export { VERBATIM_ARRAY_FIELDS, VERBATIM_STRING_FIELDS };

/**
 * `MassBankRecord` fields exempt from the two generic sweeps above (
 * `VERBATIM_STRING_FIELDS` / `VERBATIM_ARRAY_FIELDS`), either because
 * record-serializer.ts never writes them verbatim from the draft at all —
 * the peak table (always rebuilt row-by-row from typed fields, never copied
 * as strings) and the fields `buildRecord` always recomputes (`PK$SPLASH`,
 * `PK$NUM_PEAK`) — or because they genuinely ARE written verbatim but need
 * bespoke validation the generic per-field loop can't give them, so they are
 * guarded by their own dedicated call instead:
 *
 * - `ACCESSION` — mandatory and non-empty, unlike every other field here
 *   (see `checkAccession`).
 * - `PK$ANNOTATION` — each row is validated individually, with its own
 *   per-row error codes (see `checkAnnotationRebuild`).
 * - `_PK$ANNOTATION_HEADER` — written verbatim ONLY when the annotation
 *   table still has a row printing as its own `_original` (`keepsDraftHeader`); a
 *   generic sweep over `draft` can't reach it at all, since `RecordDraft`'s
 *   `Omit` drops this key from the type a caller can index through (see the
 *   module comment on `RecordDraft`) — so it is read via
 *   `readAnnotationHeader` and guarded with `checkVerbatimText` directly,
 *   gated on `keepsDraftHeader`, right where `buildRecord` handles the
 *   annotation table. `buildRecord` does NOT strip this header
 *   unconditionally — `keepsDraftHeader` keeps whatever header the draft
 *   carried in, verbatim, so a newline in it reaches the output unguarded
 *   unless validated here.
 *
 * This list's name is a statement about the SERIALIZER's behaviour, and
 * nothing here checks that the statement is actually true for a given
 * field — a field can compile fine in this list while being classified
 * wrong, because `VerbatimFieldListsAreExhaustive` below only proves every
 * field appears in exactly one list, never that it's the RIGHT one.
 * There is no cheap compile-time fix for that: which list a field belongs in
 * is a fact about record-serializer.ts's runtime behaviour, not something
 * the type system can see. The realistic mitigation is a runtime one: a
 * regression test that would fail if the guard for a "not written verbatim"
 * field were ever removed or never added — see the `_PK$ANNOTATION_HEADER`
 * newline-rejection test next to `checkVerbatimText`'s call site.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used at the type level, by the exhaustiveness check below
const NOT_WRITTEN_VERBATIM = [
  'ACCESSION',
  'PK$SPLASH',
  'PK$NUM_PEAK',
  'PK$PEAK',
  'PK$ANNOTATION',
  '_PK$ANNOTATION_HEADER',
] as const satisfies ReadonlyArray<keyof MassBankRecord>;

/**
 * Compile-time exhaustiveness check, anchored on `MassBankRecord` rather
 * than `RecordDraft`: the serializer can only ever write a field that
 * exists on `MassBankRecord`, so covering every key of that type covers
 * every field the serializer can write. (`RecordDraft`'s `Omit` drops
 * `_PK$ANNOTATION_HEADER` entirely, so a check anchored there would never
 * even see that key.)
 *
 * `UnclassifiedMassBankRecordField` is every `MassBankRecord` key absent
 * from all three lists above. `AssertNoUnclassifiedFields` only type-checks
 * when its argument extends `never`, so this line fails to compile the
 * moment `MassBankRecord` grows a field that isn't in one of the three
 * lists. When it does: read how record-serializer.ts writes the new field,
 * then classify it into `VERBATIM_STRING_FIELDS`, `VERBATIM_ARRAY_FIELDS`,
 * or `NOT_WRITTEN_VERBATIM`. Putting it in `NOT_WRITTEN_VERBATIM` is a
 * decision, not a default — confirm the serializer really doesn't write it
 * verbatim before choosing that list.
 */
type UnclassifiedMassBankRecordField = Exclude<
  keyof MassBankRecord,
  | (typeof VERBATIM_STRING_FIELDS)[number]
  | (typeof VERBATIM_ARRAY_FIELDS)[number]
  | (typeof NOT_WRITTEN_VERBATIM)[number]
>;
type AssertNoUnclassifiedFields<T extends never> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- never referenced; its only job is to fail tsc if it doesn't compile
type VerbatimFieldListsAreExhaustive =
  AssertNoUnclassifiedFields<UnclassifiedMassBankRecordField>;

/**
 * ACCESSION is the one field `buildRecord` declares mandatory, and the field
 * `validateRecord` derives a filename from; `serializeRecord` writes it as
 * the first line verbatim. Superficially close to `checkVerbatimText`'s two
 * checks (newline/carriage return, then leading/trailing whitespace) plus one
 * ACCESSION-specific addition (mandatory emptiness) — but that framing hides
 * a real difference, not just a shared-then-extended one: the emptiness
 * check runs BEFORE the whitespace check and takes priority over it, so a
 * whitespace-only value (`'   '`) reports `ACCESSION_EMPTY` here and never
 * reaches the whitespace check at all. `checkVerbatimText` has no emptiness
 * concept to run first, so the identical raw text on any other field reports
 * `VERBATIM_WHITESPACE` instead. This is exactly why the two aren't unified
 * into one code/one check despite the surface-level overlap: `ACCESSION`
 * must decide "missing" before it can decide "malformed", where an ordinary
 * field has no "missing" state at all — it is dropped when empty rather than
 * rejected (see `checkVerbatimText`'s docstring). Reported under its own
 * error codes and with ACCESSION-specific wording, since ACCESSION missing
 * or malformed is a different, more fundamental problem for a caller to read
 * than an ordinary field being unusable.
 * @param accession - the draft's `ACCESSION` value
 * @returns a `BuildError` when `accession` contains a newline or carriage
 * return (which would inject extra header lines into the serialized
 * record); is empty or whitespace-only (unreadable back — parseRecord
 * treats an empty ACCESSION as missing — checked before, and instead of, the
 * whitespace case below); or is non-empty after trimming but still has
 * leading or trailing whitespace (trimmed away on reparse, so the reparsed
 * value would differ from the one supplied)
 */
function checkAccession(accession: string): BuildError | undefined {
  const location = describeField('ACCESSION');
  if (/[\n\r]/.test(accession)) {
    return {
      code: 'ACCESSION_LINE_INJECTION',
      ...location,
      message: 'ACCESSION must not contain a newline or carriage return.',
    };
  }
  const trimmedAccession = accession.trim();
  if (trimmedAccession.length === 0) {
    return {
      code: 'ACCESSION_EMPTY',
      ...location,
      message:
        'ACCESSION must not be empty or whitespace-only — parseRecord treats an empty ACCESSION as missing and throws "ACCESSION field is required" on reparse.',
    };
  }
  if (trimmedAccession !== accession) {
    return {
      code: 'ACCESSION_WHITESPACE',
      ...location,
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
 * `VERBATIM_STRING_FIELDS` for how each of the two checks below was derived
 * and measured against parse-record.ts and record-serializer.ts.
 *
 * Deliberately has no opinion on an empty `value` — see the comment above
 * `VERBATIM_STRING_FIELDS` for why an empty single-value field is
 * canonicalised to absent rather than rejected here, and why an empty array
 * element was never a problem in the first place.
 * @param fieldName - the top-level field being checked, for error reporting
 * @param value - the draft-supplied string that will be written verbatim
 * @param rowIndex - the array element's position, when `fieldName` is one of
 * `VERBATIM_ARRAY_FIELDS` rather than a single-value field
 * @returns a `BuildError` when `value` contains a newline or carriage
 * return, or has leading or trailing whitespace of any kind
 * `String.prototype.trim()` strips
 */
function checkVerbatimText(
  fieldName: string,
  value: string,
  rowIndex?: number,
): BuildError | undefined {
  const location = describeField(fieldName, rowIndex);
  if (/[\n\r]/.test(value)) {
    return {
      code: 'VERBATIM_LINE_INJECTION',
      ...location,
      message: `${location.field} must not contain a newline or carriage return. It is written verbatim into the output: a newline would inject the text that follows it as forged lines once the record is reparsed; a carriage return reparses back to the same string at this layer but is guaranteed to fail validateRecord's serialization round-trip rule, so it is rejected here too.`,
    };
  }
  if (value.trim() !== value) {
    return {
      code: 'VERBATIM_WHITESPACE',
      ...location,
      message: `${location.field} must not have leading or trailing whitespace — parse-record.ts trims the value after the colon on reparse, so the reparsed value would differ from the one supplied.`,
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
 * @throws {BuildException} the CONTRACT of which code fires when — see each
 * named function's own docstring for the why:
 * - `ACCESSION` missing, empty, whitespace-padded, or containing a
 *   newline/carriage return (`checkAccession`).
 * - Any other field record-serializer.ts writes verbatim (or an element of
 *   an array-valued one) whitespace-padded or containing a newline/carriage
 *   return — never for being empty (`checkVerbatimText`,
 *   {@link VERBATIM_STRING_FIELDS}, {@link VERBATIM_ARRAY_FIELDS}).
 * - A peak's `relativeIntensity`, `mz`, or `intensity` not finite or
 *   negative, or the whole `PK$PEAK` table at all-zero intensity
 *   (`checkPeakRelativeIntensity`, `checkPeakMz`, `checkPeakIntensity`,
 *   `checkPeakTableAllZeroIntensity` — the last three mirror
 *   `calculateSplash` itself, see `checkPeakIntensity`'s docstring).
 * - A `PK$ANNOTATION` row's `_original` unsafe to reparse
 *   (`reparseAnnotationOriginal`), its preserved `_PK$ANNOTATION_HEADER`
 *   unsafe (`checkVerbatimText` at its call site below), or the row itself
 *   unrepresentable — a dropped source column, an unrepresentable
 *   `annotation`/numeric field, or an inexpressible optional-field
 *   combination (`checkAnnotationRebuild` and the functions it calls; see
 *   `checkAnnotationColumnGap`'s docstring for why a legal shape is a
 *   property of the record's header rather than of the fields alone).
 *
 * `error.buildErrors` carries every failure found, each with a
 * machine-readable `code`, the structured `fieldName`/`rowIndex`/`property`
 * a caller can route on directly, and the pre-formatted `field` display
 * string built from them — see {@link BuildException}. Every condition
 * `calculateSplash` would throw for is refused above first, so
 * `calculateSplash` has no way to throw from this function — see
 * `checkPeakIntensity`'s docstring for the `SplashRule` asymmetry this
 * leaves in place on the validation side.
 */
export async function buildRecord(draft: RecordDraft): Promise<MassBankRecord> {
  const errors: BuildError[] = [];

  const accessionError = checkAccession(draft.ACCESSION);
  if (accessionError) {
    errors.push(accessionError);
  }

  for (const field of VERBATIM_STRING_FIELDS) {
    const value = draft[field];
    if (value !== undefined) {
      const error = checkVerbatimText(field, value);
      if (error) {
        errors.push(error);
      }
    }
  }
  for (const field of VERBATIM_ARRAY_FIELDS) {
    const values = draft[field];
    if (values !== undefined) {
      for (const [index, value] of values.entries()) {
        const error = checkVerbatimText(field, value, index);
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
    const allZeroIntensity = checkPeakTableAllZeroIntensity(peaks);
    if (allZeroIntensity) {
      errors.push(allZeroIntensity);
    }
  }

  const annotations = draft.PK$ANNOTATION;
  // Per-row edit/safety check, computed once up front so both
  // `preservedRows` below and the per-row loop can reuse it without
  // reparsing the same `_original` twice.
  //
  // The reparse MUST use the record's own header. Since 0.5.1 the parser reads
  // columns from the header, so reparsing under a stub (this used to hardcode
  // `m/z`) drops every column past the first, makes an untouched row look
  // edited, and silently discards an `_original` that was reproducing a numeric
  // literal verbatim — turning `1888.20` into `1888.2` and failing the
  // byte-exact round-trip SerializationRule enforces.
  // A header carrying a newline is rejected further down by the
  // `_PK$ANNOTATION_HEADER` injection guard. Only its FIRST physical line may
  // reach the reparse: the injected text would break the synthetic record and
  // the failure would be reported against the row's `_original`, blaming the
  // wrong field for a fault in the header. Substituting a stub instead (as this
  // did) is worse than useless — under a stub every row looks edited, nothing
  // is preserved, the header is dropped as unused, and the injection guard
  // never runs at all.
  const rawAnnotationHeader = readAnnotationHeader(draft);
  const [draftHeaderFirstLine] = rawAnnotationHeader?.split(/[\n\r]/) ?? [];
  // A draft with no header of its own will be printed under a derived one, so
  // that is the header to measure its rows against.
  const annotationHeaderForReparse =
    draftHeaderFirstLine ?? deriveAnnotationHeader(annotations ?? []);
  const annotationEdits = annotations?.map((row, index) =>
    wasAnnotationRowEdited(row, index, annotationHeaderForReparse),
  );
  // Per row, not per table. Before 0.5.1 a rebuilt row emitted columns by field
  // *presence*, so it could differ in width from a verbatim row printed beside it
  // under one shared header — hence the all-or-nothing rule. Header-driven
  // emission makes a rebuilt row produce exactly the header's columns, so a
  // verbatim row and a rebuilt one are now interchangeable and each row keeps or
  // drops its own `_original` on its own merits.
  const preservedRows =
    annotations?.map(
      (row: AnnotationWithOriginal, index: number) =>
        row._original !== undefined &&
        annotationEdits?.[index]?.edited === false,
    ) ?? [];
  // Which header the rows will actually be printed under — the same choice
  // record-serializer.ts makes, and the yardstick every rebuilt row is measured
  // against. The draft's own header is kept only while some row still prints as
  // its own source text; once every row is rebuilt the header is dropped (see
  // below) and the serializer derives one that fits.
  const keepsDraftHeader =
    draftHeaderFirstLine !== undefined && preservedRows.some(Boolean);
  const effectiveAnnotationHeader = keepsDraftHeader
    ? draftHeaderFirstLine
    : deriveAnnotationHeader(annotations ?? []);
  const effectiveAnnotationColumns = mapAnnotationHeader(
    effectiveAnnotationHeader,
  );
  if (annotations !== undefined) {
    for (const [index, row] of annotations.entries()) {
      const originalError = annotationEdits?.[index]?.error;
      if (originalError) {
        errors.push(originalError);
      }
      errors.push(...checkAnnotationFiniteValues(row, index));
      if (preservedRows[index] !== true) {
        errors.push(
          ...checkAnnotationRebuild(
            row,
            index,
            effectiveAnnotationHeader,
            effectiveAnnotationColumns,
          ),
        );
      }
    }
  }

  // The header is written verbatim whenever it is kept, so a newline in it
  // would forge rows or fields on reparse. Guarded against the RAW value, not
  // the first line the checks above use — truncating is a reading convenience
  // here, never a sanitiser.
  if (keepsDraftHeader && rawAnnotationHeader !== undefined) {
    const headerError = checkVerbatimText(
      '_PK$ANNOTATION_HEADER',
      rawAnnotationHeader,
    );
    if (headerError) {
      errors.push(headerError);
    }
  }

  if (errors.length > 0) {
    throw new BuildException(errors);
  }

  const record: MassBankRecord = { ...draft };

  // An empty single-value verbatim field canonicalises to absent rather
  // than being rejected — see the comment above VERBATIM_STRING_FIELDS and
  // checkVerbatimText's docstring for why. record-serializer.ts would never
  // print it anyway (it guards every write with `if (record.FIELD)`, and
  // `''` is falsy), so this only removes a value that could never reach the
  // output regardless.
  for (const field of VERBATIM_STRING_FIELDS) {
    if (record[field] === '') {
      Reflect.deleteProperty(record, field);
    }
  }

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
      // Index BEFORE .toSorted — `preservedRows` is in draft order, and sorting
      // first would pair each row with another row's verdict.
      .map((a: AnnotationWithOriginal, index: number) => ({
        mz: a.mz,
        ...(a.annotation === undefined ? {} : { annotation: a.annotation }),
        ...(a.exactMass === undefined ? {} : { exactMass: a.exactMass }),
        ...(a.errorPpm === undefined ? {} : { errorPpm: a.errorPpm }),
        ...(a.extra === undefined ? {} : { extra: a.extra }),
        ...(preservedRows[index] === true && a._original !== undefined
          ? { _original: a._original }
          : {}),
      }))
      .toSorted((a, b) => a.mz - b.mz);
    if (preservedRows.some(Boolean)) {
      // At least one row prints its own source text verbatim, so it must print
      // under the header it was parsed from. Keep whatever the draft carried in
      // (a parsed MassBankRecord passed straight through — RecordDraft's Omit
      // only blocks object literals, not variables). Already validated above.
    } else {
      // Every row is being rebuilt from typed fields. A header the draft
      // happens to carry may not name the columns those rows populate, and
      // emitting under it would truncate them — so drop it and let the
      // serializer derive one that fits.
      delete (record as { _PK$ANNOTATION_HEADER?: string })
        ._PK$ANNOTATION_HEADER;
    }
  } else {
    // Keep the canonical shape empty-table-free, matching the PK$NUM_PEAK
    // and PK$SPLASH deletes above rather than carrying an empty array.
    delete record.PK$ANNOTATION;
    delete record._PK$ANNOTATION_HEADER;
  }

  return record;
}
