import type { TextData } from 'cheminfo-types';
import { ensureString } from 'ensure-string';

import { parseRecord } from '../parser/parse-record.js';

import { calculateSplash } from './calculate-splash.js';

// PK$SPLASH is the first line of the PK$ section (order: SPLASH, ANNOTATION,
// NUM_PEAK, PEAK), so a missing one is inserted just before whichever of these
// appears first — matching the canonical position the serializer emits.
const PK_SECTION_ANCHOR = /^PK\$(?:ANNOTATION|NUM_PEAK|PEAK):/m;
const EXISTING_SPLASH_LINE = /^PK\$SPLASH:[^\r\n]*/m;

/**
 * Generate and insert a canonical `PK$SPLASH` for a record.
 *
 * Computes the SPLASH from the record's peaks and returns the record text with
 * `PK$SPLASH` set: the line is replaced if present, or inserted in canonical
 * position if missing. Pure — it returns new text and never mutates input.
 * This is the offline "fill SPLASH at ingest" building block; the validator
 * itself stays non-mutating.
 * @param content - the MassBank record text (missing or stale PK$SPLASH)
 * @returns the record text with a correct PK$SPLASH
 * @throws {RangeError} if the record has no peaks (or all-zero intensity) to hash
 */
export async function fillSplash(content: TextData): Promise<string> {
  const text = ensureString(content);
  const record = parseRecord(text);

  const peaks = (record.PK$PEAK ?? []).map((p) => ({
    mz: p.mz,
    intensity: p.intensity,
  }));
  const splash = await calculateSplash(peaks);
  const splashLine = `PK$SPLASH: ${splash}`;

  if (EXISTING_SPLASH_LINE.test(text)) {
    return text.replace(EXISTING_SPLASH_LINE, splashLine);
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const anchor = PK_SECTION_ANCHOR.exec(text);
  if (anchor) {
    return (
      text.slice(0, anchor.index) + splashLine + eol + text.slice(anchor.index)
    );
  }

  // No PK$ section anchor (unusual): insert before the record terminator.
  return text.replace(/^\/\//m, `${splashLine}${eol}//`);
}
