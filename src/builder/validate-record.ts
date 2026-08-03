import type { MassBankRecord } from '../record.ts';
import { serializeRecord } from '../serializer/record-serializer.ts';
import type { ValidationOptions, ValidationResult } from '../types.ts';
import { validateContent } from '../validator/validateContent.ts';

/**
 * Validate a structured record by serialising it and running the text rules.
 *
 * Delegates to validateContent rather than reimplementing anything, so the
 * two entry points share one rule implementation — not a promise that a
 * given record's verdict stays the same across releases; see the mandatory
 * fields/CV limit below.
 *
 * Two limits:
 *
 * The filename is derived from the RAW ACCESSION value (as
 * `${record.ACCESSION}.txt`), because a MassBankRecord has none — but
 * AccessionMatchRule compares that filename against the ACCESSION field of
 * the record AFTER a serialize→parse round trip, and parseRecord trims. So
 * this rule can fail here on either of two independent, unrelated things,
 * neither needing the other: leading/trailing whitespace in ACCESSION
 * (trimmed away by the round trip but not by this filename construction —
 * measured: `validateRecord({ ACCESSION: ' MSBNK-test-TST00001' })` reports
 * "ACCESSION mismatch" with no path separator anywhere), and a path
 * separator in ACCESSION (e.g. 'foo/bar' or 'foo\bar', which trips the rule
 * against a basename it never saw). This whole path never has a real
 * external file to check against, so neither a pass nor a fail here says
 * anything about whether a REAL file's name would match — a green result is
 * NOT evidence that it would, and a red one may just mean ACCESSION had
 * incidental whitespace. Use validate() or validateContent() with the real
 * filename for that instead.
 *
 * Mandatory fields and controlled vocabularies are not currently checked. A
 * record containing only ACCESSION returns success; a green result means
 * "round-trips and passes the current rule set", not "submittable to
 * MassBank".
 * @param record - the structured record to validate
 * @param options - validation options, forwarded to validateContent
 * @returns the validation result
 */
export async function validateRecord(
  record: MassBankRecord,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  return validateContent(
    serializeRecord(record),
    `${record.ACCESSION}.txt`,
    options,
  );
}
