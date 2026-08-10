import { mapAnnotationHeader } from '../../parser/annotation-columns.js';
import { PositionUtils } from '../../parser/index.js';
import type { MassBankRecord } from '../../record.js';
import type { ValidationError, ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

/**
 * Warns when a record's `PK$ANNOTATION` header cannot be read positionally.
 *
 * Since 0.5.1 the parser assigns each annotation token to the column its header
 * names. `mapAnnotationHeader` returns `null` for a header it cannot use that
 * way — one that does not begin with the m/z column, or that names the same
 * typed field twice — and every row then falls back to guessing the layout from
 * its token count, which is the behaviour whose silent losses 0.5.1 removed.
 * The fallback is deliberate (refusing to parse such a record would be worse),
 * but it is exactly the case a reader should be told about, because the typed
 * fields may not hold what the header claims.
 *
 * This lives at the validation layer rather than the parser because
 * `parseRecord(text): MassBankRecord` has no warning channel and gaining one
 * would mean changing its signature; `validateContent` already returns
 * `{ errors, warnings }` and already walks the parsed record.
 *
 * Warning-only, never a blocking error: the record is still readable, and a
 * header nobody has agreed on is a contributor convention rather than a grammar
 * violation — the Java reference defines no annotation column vocabulary at all.
 * An unrecognised column name is NOT warned about: it is routed into
 * `Annotation.extra` losslessly, so nothing is at risk.
 */
export class AnnotationHeaderRule implements IValidationRule {
  validate(): ValidationError[] {
    return [];
  }

  getWarnings(
    record: MassBankRecord,
    originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: ValidationRuleOptions,
  ): ValidationWarning[] {
    const header = record._PK$ANNOTATION_HEADER;
    if (header === undefined || mapAnnotationHeader(header) !== null) {
      return [];
    }

    const index = originalText.indexOf('PK$ANNOTATION:');
    const position =
      index === -1
        ? undefined
        : PositionUtils.getLineColumn(originalText, index);

    return [
      {
        file: filename,
        ...(position === undefined
          ? {}
          : { line: position.line, column: position.column }),
        message: `PK$ANNOTATION header '${header}' could not be read positionally — it must begin with the m/z column and must not name the same field twice. Each row's columns were guessed from its token count instead, so the parsed annotation fields may not match what the header names.`,
      },
    ];
  }
}
