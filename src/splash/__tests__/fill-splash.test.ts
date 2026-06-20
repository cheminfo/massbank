import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRecord } from '../../parser/parse-record.js';
import { validateContent } from '../../validator/validateContent.js';
import { calculateSplash } from '../calculate-splash.js';
import { fillSplash } from '../fill-splash.js';

const RECORD_FILE = join(
  import.meta.dirname,
  '../../__tests__/data/MSBNK-test-TST00001.txt',
);
const FILENAME = 'MSBNK-test-TST00001.txt';

async function load(): Promise<string> {
  return readFile(RECORD_FILE, 'utf8');
}

describe('fillSplash', () => {
  it('inserts a correct PK$SPLASH when the record has none', async () => {
    const original = await load();
    const stripped = original.replace(/^PK\$SPLASH:[^\r\n]*\r?\n/m, '');

    expect(stripped).not.toContain('PK$SPLASH:');

    const filled = await fillSplash(stripped);

    // The field is now present...
    expect(filled).toContain('PK$SPLASH:');

    // ...and equals the canonical SPLASH for the peaks...
    const record = parseRecord(filled);
    const expected = await calculateSplash(
      (record.PK$PEAK ?? []).map((p) => ({ mz: p.mz, intensity: p.intensity })),
    );

    expect(record.PK$SPLASH).toBe(expected);

    // ...and the filled record validates clean (round-trip + splash).
    const result = await validateContent(filled, FILENAME);

    expect(result.errors).toStrictEqual([]);
  });

  it('replaces an incorrect PK$SPLASH with the correct one', async () => {
    const original = await load();
    const tampered = original.replace(
      /^PK\$SPLASH:.*$/m,
      'PK$SPLASH: splash10-0000-0000000000-000000000000000000ff',
    );

    const filled = await fillSplash(tampered);

    const result = await validateContent(filled, FILENAME);

    expect(result.errors.filter((e) => e.type === 'splash')).toStrictEqual([]);
    expect(result.success).toBe(true);
  });

  it('is a no-op (still valid) for a record whose PK$SPLASH is already correct', async () => {
    const original = await load();
    const filled = await fillSplash(original);
    const result = await validateContent(filled, FILENAME);

    expect(result.success).toBe(true);
  });

  it('throws RangeError when the record has no peaks to hash', async () => {
    const noPeaks = 'ACCESSION: MSBNK-test-TST00001\nRECORD_TITLE: x\n//\n';

    await expect(fillSplash(noPeaks)).rejects.toThrow(RangeError);
  });
});
