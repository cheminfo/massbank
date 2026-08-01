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
 * The filename is derived from ACCESSION, because a MassBankRecord has none.
 * AccessionMatchRule therefore cannot fail here for any well-formed ACCESSION —
 * a green result is NOT evidence that the accession matches any external
 * filename. (An ACCESSION containing a path separator, e.g. 'foo/bar' or
 * 'foo\bar', would still trip the rule against a basename it never saw — a
 * confusing error, not a false pass.) Use validate() or validateContent() with
 * the real filename for that.
 *
 * Mandatory fields and controlled vocabularies are NOT checked. A record
 * containing only ACCESSION returns success. Those rules arrive in later
 * releases; until then a green result means "round-trips and passes the current
 * rule set", not "submittable to MassBank".
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
