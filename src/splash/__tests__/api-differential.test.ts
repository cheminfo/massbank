import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRecord } from '../../parser/parse-record.js';
import type { SplashPeak } from '../calculate-splash.js';
import { calculateSplash } from '../calculate-splash.js';

/**
 * Dev-only differential check: compute each record's SPLASH locally AND via the
 * Fiehn Lab SPLASH service, and assert they agree (two-sided validation).
 *
 * This is the network dependency the local implementation removes, so it is
 * NEVER part of `npm test`/CI — it runs only when SPLASH_API_CHECK=1:
 *
 *   SPLASH_API_CHECK=1 npm run test-only -- src/splash/__tests__/api-differential.test.ts
 *
 * By default it checks this package's own committed records. Point it at a
 * directory of real MassBank `.txt` records for breadth:
 *
 *   SPLASH_API_CHECK=1 SPLASH_SAMPLES_DIR=/path/to/samples npm run test-only -- \
 *     src/splash/__tests__/api-differential.test.ts
 */

const API_URL = 'https://splash.fiehnlab.ucdavis.edu/splash/it';
const ENABLED = process.env.SPLASH_API_CHECK === '1';

const COMMITTED_DATA_DIR = join(import.meta.dirname, '../../__tests__/data');
const SAMPLES_DIR = process.env.SPLASH_SAMPLES_DIR;

/**
 * Compute a SPLASH via the Fiehn Lab API.
 * @param peaks - the spectrum peaks
 * @returns the API's SPLASH string
 */
async function splashViaApi(peaks: SplashPeak[]): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ions: peaks.map((p) => ({ mass: p.mz, intensity: p.intensity })),
      type: 'MS',
    }),
  });
  if (!response.ok) {
    throw new Error(`SPLASH API ${response.status} ${response.statusText}`);
  }
  const body = await response.text();
  return body.trim();
}

/**
 * Read every `.txt` record in a directory and extract its peaks.
 * @param dir - directory of MassBank record files
 * @returns parsed records with their peaks (records without peaks are skipped)
 */
async function loadRecords(
  dir: string,
): Promise<Array<{ file: string; peaks: SplashPeak[] }>> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith('.txt'));
  const out: Array<{ file: string; peaks: SplashPeak[] }> = [];
  for (const file of files) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential file reads are fine for a dev script
      const record = parseRecord(await readFile(join(dir, file), 'utf8'));
      if (record.PK$PEAK && record.PK$PEAK.length > 0) {
        out.push({
          file,
          peaks: record.PK$PEAK.map((p) => ({
            mz: p.mz,
            intensity: p.intensity,
          })),
        });
      }
    } catch {
      // Skip records that don't parse (e.g. deliberate error fixtures).
    }
  }
  return out;
}

describe.skipIf(!ENABLED)('SPLASH local vs Fiehn Lab API (dev-only)', () => {
  const dir = SAMPLES_DIR ?? COMMITTED_DATA_DIR;

  it('agrees with the API on every record in the directory', async () => {
    const records = await loadRecords(dir);

    expect(records.length).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const { file, peaks } of records) {
      // eslint-disable-next-line no-await-in-loop -- sequential, to avoid hammering the public API
      const [local, api] = await Promise.all([
        calculateSplash(peaks),
        splashViaApi(peaks),
      ]);
      if (local !== api) {
        mismatches.push(`${file}: local ${local} != api ${api}`);
      }
    }

    expect(mismatches).toStrictEqual([]);
  }, 120_000);
});
