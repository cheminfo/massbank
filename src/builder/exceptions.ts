/**
 * Machine-readable reason a single `RecordDraft` field, row, or element
 * failed a `buildRecord` guard. One member per failure the caller must
 * respond to differently — not per throw site, and not per field either:
 *
 * - `ANNOTATION_NOT_FINITE` covers `mz`, `exactMass`, and `errorPpm` alike,
 *   because every field it can fire on shares one remedy ("make the value
 *   finite") — `BuildError.property` tells a caller which field, and no
 *   caller response differs by field, so a single code is the right
 *   granularity. `ACCESSION_*` and `VERBATIM_*` are deliberately NOT merged
 *   into one code the same way, even though `checkAccession` and
 *   `checkVerbatimText` share two of their three checks: `ACCESSION` is
 *   mandatory (rejects empty) where every other verbatim field is optional
 *   (an empty one canonicalises to absent instead, see `checkVerbatimText`'s
 *   docstring) — that is a real behavioural difference, not just a naming
 *   one, so collapsing the codes would either make `ACCESSION` stop
 *   rejecting empty or make every other field start rejecting it.
 * - The four `PK$ANNOTATION` shape failures below (`ANNOTATION_*_WITHOUT_*`,
 *   `ANNOTATION_TEXT_LOOKS_NUMERIC`) each need a different fix from the
 *   caller — add a field, clear one, or rename an annotation — so they are
 *   split one code per failure rather than sharing `field`-based prose.
 * - `PEAK_MZ_NEGATIVE` and the two `PEAK_RELATIVE_INTENSITY_*` codes name
 *   their field in the code itself, unlike `ANNOTATION_NOT_FINITE`: `PK$PEAK`
 *   has few enough numeric guards, each with its own bespoke rationale (see
 *   `checkPeakMz`/`checkPeakRelativeIntensity`), that folding them into one
 *   shared cause code would force a caller to read `property` just to know
 *   which check fired at all.
 */
export type BuildErrorCode =
  | 'ACCESSION_LINE_INJECTION'
  | 'ACCESSION_EMPTY'
  | 'ACCESSION_WHITESPACE'
  | 'VERBATIM_LINE_INJECTION'
  | 'VERBATIM_WHITESPACE'
  | 'PEAK_MZ_NEGATIVE'
  | 'PEAK_RELATIVE_INTENSITY_NOT_FINITE'
  | 'PEAK_RELATIVE_INTENSITY_NEGATIVE'
  | 'ANNOTATION_DISCARDED_COLUMN'
  | 'ANNOTATION_TEXT_NOT_ROUND_TRIPPABLE'
  | 'ANNOTATION_NOT_FINITE'
  | 'ANNOTATION_EXACT_MASS_WITHOUT_ANNOTATION'
  | 'ANNOTATION_ERROR_PPM_WITHOUT_ANNOTATION'
  | 'ANNOTATION_ERROR_PPM_WITHOUT_EXACT_MASS'
  | 'ANNOTATION_TEXT_LOOKS_NUMERIC'
  | 'ANNOTATION_ORIGINAL_LINE_INJECTION'
  | 'ANNOTATION_ORIGINAL_UNREADABLE';

/**
 * A single failure collected while validating a `RecordDraft`.
 */
export interface BuildError {
  /** Which rule failed — see {@link BuildErrorCode}. */
  code: BuildErrorCode;
  /**
   * The top-level `RecordDraft` key the failure is about, e.g. `'ACCESSION'`,
   * `'PK$ANNOTATION'`, or `'CH$NAME'` — never indexed, so a caller can group
   * failures by field without parsing `field`.
   */
  fieldName: string;
  /**
   * The row's (or array element's) position in `RecordDraft`, present only
   * when the failure is about one row of `PK$PEAK`/`PK$ANNOTATION` or one
   * element of an array-valued field. Absent for a whole-field failure
   * (`ACCESSION`, a single-value verbatim field).
   *
   * This is DRAFT order, not output order: `buildRecord` sorts `PK$PEAK` and
   * `PK$ANNOTATION` by `mz` in the record it *returns*, but a draft that
   * fails validation is never built, so `PK$ANNOTATION[0]` here and
   * `record.PK$ANNOTATION[0]` after a later, successful build can name two
   * different rows. There is no output-order equivalent to map this to.
   */
  rowIndex?: number;
  /**
   * The row's specific property the failure is about, e.g. `'mz'` or
   * `'_original'`, present only when the failure concerns one property
   * rather than the whole row — a `PK$ANNOTATION` shape failure
   * (`ANNOTATION_TEXT_LOOKS_NUMERIC` and its siblings) spans the combination
   * of several properties at once and so has none.
   */
  property?: string;
  /**
   * A single display string built from `fieldName`/`rowIndex`/`property` —
   * `'ACCESSION'`, `'CH$NAME[1]'` for an array element, or
   * `'PK$ANNOTATION[3]'` / `'PK$ANNOTATION[3].mz'` for a table row (or one
   * property of it). Kept alongside the structured fields above for display
   * and for any caller that was already parsing it; a caller routing
   * failures programmatically should prefer `fieldName`/`rowIndex`/
   * `property` over parsing this string.
   */
  field: string;
  /** Human-readable explanation of the failure. */
  message: string;
}

/**
 * Thrown by `buildRecord` when one or more `RecordDraft` fields, rows, or
 * elements fail a guard. Carries every failure found, not only the first —
 * the guards are pure and independent, so a caller building a record editor
 * can route each failure (e.g. "row 3's annotation is unrepresentable" vs
 * "ACCESSION is empty") to the right place in one pass instead of fixing and
 * resubmitting once per failure.
 *
 * Sibling to `ParseException` (`src/parser/exceptions.ts`): same shape
 * (a structured payload plus a human-readable `message`), extended to an
 * array because aggregation is the point here, where `ParseException` only
 * ever reports the one parse error that stopped it.
 */
export class BuildException extends Error {
  readonly buildErrors: readonly BuildError[];

  /**
   * Construct a `BuildException` from every failure found.
   * @param buildErrors - every failure found while validating the draft;
   * expected to be non-empty (`buildRecord` never throws this with none).
   * @param message - overrides the default message built from `buildErrors`.
   */
  constructor(buildErrors: readonly BuildError[], message?: string) {
    super(message ?? BuildException.formatMessage(buildErrors));
    this.buildErrors = buildErrors;
    this.name = 'BuildException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    const ErrorConstructor = Error as typeof Error & {
      captureStackTrace?: (
        error: Error,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor: new (...args: any[]) => Error,
      ) => void;
    };
    if (typeof ErrorConstructor.captureStackTrace === 'function') {
      ErrorConstructor.captureStackTrace(this, BuildException);
    }
  }

  /**
   * Build a default `Error.message` that still reads well when a caller
   * only looks at `error.message` and never touches `buildErrors` — capped
   * so a draft with dozens of failures (a real corpus record edited into
   * unrecognisable shape can produce well over a hundred) doesn't produce a
   * message tens of thousands of characters long, which is unusable in a log
   * line or an error-tracker title.
   * @param buildErrors - the failures to summarise
   * @returns every failure, one per line, prefixed with its field — unless
   * there are more than `SUMMARY_THRESHOLD`, in which case a one-line summary
   * naming the first few and how many more there are
   */
  private static formatMessage(buildErrors: readonly BuildError[]): string {
    const SUMMARY_THRESHOLD = 3;
    // Most messages already start by naming their own field (e.g. checkAccession's
    // "ACCESSION must not ..."), so prefixing `field` again would print it twice.
    // Only add the prefix when the message doesn't already carry it.
    const lines = buildErrors.map((error) =>
      error.message.startsWith(error.field)
        ? error.message
        : `${error.field}: ${error.message}`,
    );

    if (lines.length <= SUMMARY_THRESHOLD) {
      return lines.join('\n');
    }

    const shown = lines.slice(0, SUMMARY_THRESHOLD).join('; ');
    const remaining = lines.length - SUMMARY_THRESHOLD;
    return `${lines.length} problems building the record: ${shown}; and ${remaining} more (see error.buildErrors).`;
  }
}
