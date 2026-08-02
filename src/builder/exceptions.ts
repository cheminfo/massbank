/**
 * Machine-readable reason a single `RecordDraft` field, row, or element
 * failed a `buildRecord` guard. One member per distinct failure mode, not
 * per throw site — e.g. a non-finite `mz`, `exactMass`, and `errorPpm` on
 * the same PK$ANNOTATION row all report as `ANNOTATION_NOT_FINITE`,
 * distinguished from one another by `BuildError.field`.
 */
export type BuildErrorCode =
  | 'ACCESSION_LINE_INJECTION'
  | 'ACCESSION_EMPTY'
  | 'ACCESSION_WHITESPACE'
  | 'VERBATIM_LINE_INJECTION'
  | 'VERBATIM_EMPTY'
  | 'VERBATIM_WHITESPACE'
  | 'PEAK_INVALID_RELATIVE_INTENSITY'
  | 'PEAK_NEGATIVE_MZ'
  | 'ANNOTATION_DISCARDED_COLUMN'
  | 'ANNOTATION_TEXT_NOT_ROUND_TRIPPABLE'
  | 'ANNOTATION_NOT_FINITE'
  | 'ANNOTATION_UNREPRESENTABLE'
  | 'ANNOTATION_ORIGINAL_LINE_INJECTION'
  | 'ANNOTATION_ORIGINAL_UNREADABLE';

/**
 * A single failure collected while validating a `RecordDraft`.
 */
export interface BuildError {
  /** Which rule failed — see {@link BuildErrorCode}. */
  code: BuildErrorCode;
  /**
   * The offending field, e.g. `'ACCESSION'`, `'CH$NAME[1]'` for an array
   * element, or `'PK$ANNOTATION[3]'` / `'PK$ANNOTATION[3].mz'` for a table
   * row (or one field of it).
   */
  field: string;
  /** Human-readable explanation, unchanged from the prose these guards used to throw directly. */
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
  readonly buildErrors: BuildError[];

  /**
   * Construct a `BuildException` from every failure found.
   * @param buildErrors - every failure found while validating the draft;
   * expected to be non-empty (`buildRecord` never throws this with none).
   * @param message - overrides the default message built from `buildErrors`.
   */
  constructor(buildErrors: BuildError[], message?: string) {
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
   * only looks at `error.message` and never touches `buildErrors`.
   * @param buildErrors - the failures to summarise
   * @returns one line per failure, prefixed with its field
   */
  private static formatMessage(buildErrors: BuildError[]): string {
    return buildErrors
      .map((error) => `${error.field}: ${error.message}`)
      .join('\n');
  }
}
