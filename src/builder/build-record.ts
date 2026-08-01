import type { Annotation, InternalRecord, Peak } from '../record.ts';
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
 * A non-finite `mz`, `exactMass`, or `errorPpm` serializes to a literal like
 * `"NaN"` or `"Infinity"`. For `mz` specifically, the parser bails on that
 * token (`Number.parseFloat` returns `NaN` for it) and the whole row silently
 * vanishes on reparse. For `exactMass`/`errorPpm`, the literal either fails
 * the parser's own numeric test (and is then silently discarded rather than
 * reparsed) or is nonsensical as a physical quantity even where it happens to
 * reparse.
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
 * all-zero or non-finite. An empty peak list is dropped rather than hashed, so
 * it never reaches this error. Note SplashRule swallows the same error; the
 * builder does not, because such a spectrum is not publishable.
 * @throws {RangeError} when an annotation row cannot survive a PK$ANNOTATION
 * round-trip: `annotation` is empty, whitespace-only, or contains internal
 * whitespace; `mz`, `exactMass`, or `errorPpm` is not finite; `exactMass` or
 * `errorPpm` is set alone with no `annotation`; `errorPpm` is set with
 * `annotation` but no `exactMass`; or `annotation` looks numeric while
 * `exactMass` is set and `errorPpm` is not. See
 * {@link assertExpressibleAnnotation} for the full legal/illegal table and
 * why it is not simply "a prefix of `[annotation, exactMass, errorPpm]`".
 */
export async function buildRecord(draft: RecordDraft): Promise<InternalRecord> {
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
    // An empty table serializes as a header with no rows.
    delete record.PK$ANNOTATION;
  }

  return record;
}
