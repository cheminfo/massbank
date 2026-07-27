/**
 * Shared predicates for recognizing "this line starts a new record field" —
 * a key made of letters, digits, `_`, or `$`, immediately followed by a colon.
 *
 * Matching the first colon anywhere (the old approach) misreads table rows whose
 * values legitimately contain colons: lipid nomenclature such as
 * `[lyso_PC(alkyl-18:0,-)]-` produced a bogus field key of
 * `494.35 1 [lyso_PC(alkyl-18` in both the table parsers and the unrecognized-field
 * validation rule. Both call sites need the same "field key" shape, but with
 * different casing rules — see the two exports below for why they differ.
 *
 * `parse-record.ts` deliberately does NOT use these predicates. It splits on the first
 * colon and throws `Invalid line format` on a line without one; converting it would turn
 * parse errors into silently skipped lines.
 */

/**
 * Upper-case-only: `PK$NUM_PEAK:`, `RECORD_TITLE:`, `CH$NAME:`.
 *
 * Used by the table parsers (`table-parsers.ts`) to decide when a peak/annotation
 * table ends. This is deliberately conservative — a mis-cased key (e.g.
 * `record_title:`) must NOT prematurely end a table, because the fallback if it did
 * would be worse: the rest of the table would be swallowed as "unrecognized field"
 * lines. `startsNewField` implies the line contains a colon, so this predicate is
 * strictly narrower than the old `includes(':')` check it replaced — a table can
 * only grow, never shrink.
 *
 * Trade-off: a malformed key containing `-` or `.` (e.g. `MS$FOCUSED-ION:`) no
 * longer ends the table and is swallowed by the row parser; `SerializationRule`
 * still rejects such a record, so nothing is silently accepted — only the
 * diagnostic is less precise.
 */
export const FIELD_LINE_STRICT = /^[A-Z][A-Z0-9_$]*:/;

/**
 * Check whether a trimmed line starts a new record field (upper-case key only).
 * @param trimmedLine - A line from the record text, already trimmed
 * @returns True if the line looks like `KEY:` with an upper-case key
 */
export function startsNewField(trimmedLine: string): boolean {
  return FIELD_LINE_STRICT.test(trimmedLine);
}

/**
 * Case-insensitive on the leading letter: matches `RECORD_TITLE:` and also
 * `record_title:`.
 *
 * Used by `UnrecognizedFieldRule` to decide whether a line is a field line at all
 * (as opposed to a table row). Here a mis-cased key is exactly the typo this rule
 * exists to report, so it must still be recognized as a field line — the rule
 * looks the key up in its recognized-field set afterwards and warns if it doesn't
 * match (case-sensitively), catching the mis-casing. Table rows always begin with
 * a numeric m/z, so they can never match this pattern either.
 */
export const FIELD_LINE_ANY_CASE = /^(?<key>[A-Za-z][A-Za-z0-9_$]*):/;

/**
 * Extract the field key from a trimmed line, if it looks like a field line at all
 * (case-insensitive on the leading letter).
 * @param trimmedLine - A line from the record text, already trimmed
 * @returns The field key as written (any casing), or null if the line is not a field line
 */
export function matchFieldKey(trimmedLine: string): string | null {
  const match = FIELD_LINE_ANY_CASE.exec(trimmedLine);
  return match?.groups?.key ?? null;
}
