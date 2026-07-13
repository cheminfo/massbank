import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { parseRecord } from '../../parser/parse-record.ts';
import { calculateSplash } from '../calculate-splash.ts';

const DATA_DIR = join(import.meta.dirname, '../../__tests__/data');

const RECORD_FILES = [
  'MSBNK-test-TST00001.txt',
  'MSBNK-test-TST00002.txt',
  'MSBNK-test-TST00003.txt',
];

test.each(RECORD_FILES)(
  'reproduces the PK$SPLASH declared in %s',
  async (file) => {
    const content = await readFile(join(DATA_DIR, file), 'utf8');
    const record = parseRecord(content);

    // Sanity: the fixture actually declares a SPLASH and peaks.
    expect(record.PK$SPLASH).toBeDefined();

    const peaks = record.PK$PEAK ?? [];

    expect(peaks.length).toBeGreaterThan(0);

    const calculated = await calculateSplash(
      peaks.map((p) => ({ mz: p.mz, intensity: p.intensity })),
    );

    expect(calculated).toBe(record.PK$SPLASH);
  },
);
