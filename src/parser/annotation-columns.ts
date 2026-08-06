/**
 * Which typed field a PK$ANNOTATION column feeds, or `null` when the column has
 * no typed field and belongs in `Annotation.extra`.
 */
export type AnnotationField = 'mz' | 'annotation' | 'exactMass' | 'errorPpm';

/**
 * One column of a PK$ANNOTATION header, in header order.
 */
export interface AnnotationColumn {
  /** The header token exactly as written, e.g. `error(ppm)` or `formula_count`. */
  token: string;
  /** The typed field it feeds, or `null` to route the value into `extra[token]`. */
  field: AnnotationField | null;
}

/**
 * Reduce a header token to its matchable form: lowercase, with every
 * non-alphanumeric character removed.
 *
 * This is what lets one vocabulary entry cover `error(ppm)`, `error_ppm` and
 * `ppm`. Matching literally would mean a table that grows every time a
 * contributor picks different punctuation.
 * @param token - a single whitespace-delimited header token
 * @returns the normalised form used for vocabulary lookup
 */
export function normaliseHeaderToken(token: string): string {
  return token.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/**
 * Normalised header token -> typed field.
 *
 * Derived from every distinct PK$ANNOTATION header observed in real data — the
 * 112-record sample corpus (50 annotated, all using
 * `m/z tentative_formula formula_count mass error(ppm)`), this repository's own
 * fixtures (`m/z annotation exact_mass error(ppm)`, `m/z ion`, `m/z`), and the
 * Java reference tools' test resources (`m/z annotation exact_mass error(ppm)`).
 *
 * Deliberately NOT extended by imagination. The Java grammar defines no
 * controlled vocabulary for annotation columns, so the header space is open
 * ended; a token nobody has been observed to use belongs in `extra`, where it
 * is preserved losslessly and costs nothing. Guessing at a mapping is how a
 * column ends up silently relabelled.
 *
 * Note what is absent: a bare `error` maps to `errorPpm`, but `error(mDa)`
 * normalises to `errormda`, matches nothing, and lands in `extra` — which is
 * the safe outcome. A millidalton error must not be relabelled as ppm.
 */
const FIELD_BY_TOKEN = new Map<string, AnnotationField>([
  ['mz', 'mz'],
  ['annotation', 'annotation'],
  ['tentativeformula', 'annotation'],
  ['ion', 'annotation'],
  ['exactmass', 'exactMass'],
  ['mass', 'exactMass'],
  ['errorppm', 'errorPpm'],
  ['error', 'errorPpm'],
  ['ppm', 'errorPpm'],
]);

/**
 * Map a PK$ANNOTATION header line's value to its columns, in order.
 *
 * The first column must be the m/z — every observed header starts with it, and
 * a table whose first column is something else cannot be read positionally at
 * all. Returning `null` in that case tells the caller to take the token-count
 * fallback rather than mis-assign every row.
 *
 * A header that repeats a typed field (`m/z mass mass`) is also refused: the
 * second occurrence would silently overwrite the first, which is the class of
 * quiet corruption this whole module exists to remove. Repeated *untyped*
 * tokens are fine — they are distinct keys in `extra` only if their tokens
 * differ, so an exact duplicate token is refused too.
 * @param header - the header value, i.e. the part after `PK$ANNOTATION:`
 * @returns the columns in header order, or `null` when the header cannot be
 * used positionally and the caller should fall back
 */
export function mapAnnotationHeader(header: string): AnnotationColumn[] | null {
  const tokens = header.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0];
  if (first === undefined || normaliseHeaderToken(first) !== 'mz') return null;

  const columns: AnnotationColumn[] = [];
  const seenFields = new Set<AnnotationField>();
  const seenTokens = new Set<string>();

  for (const token of tokens) {
    const normalised = normaliseHeaderToken(token);
    if (seenTokens.has(normalised)) return null;
    seenTokens.add(normalised);

    const field = FIELD_BY_TOKEN.get(normalised) ?? null;
    if (field !== null) {
      if (seenFields.has(field)) return null;
      seenFields.add(field);
    }
    columns.push({ token, field });
  }

  return columns;
}
