import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { validateContent } from '../validator/validateContent.ts';

const RECORD_FILE = join(import.meta.dirname, 'data/MSBNK-test-TST00001.txt');
const FILENAME = 'MSBNK-test-TST00001.txt';

test('reports no SPLASH error for a record whose PK$SPLASH is correct', async () => {
  const content = await readFile(RECORD_FILE, 'utf8');
  const result = await validateContent(content, FILENAME);

  expect(result.errors.filter((e) => e.type === 'splash')).toStrictEqual([]);
});

test('reports a blocking SPLASH error when PK$SPLASH is tampered', async () => {
  const content = await readFile(RECORD_FILE, 'utf8');
  const tampered = content.replace(
    /PK\$SPLASH: .*/,
    'PK$SPLASH: splash10-0000-0000000000-0000000000000000000a',
  );

  const result = await validateContent(tampered, FILENAME);
  const splashErrors = result.errors.filter((e) => e.type === 'splash');

  expect(splashErrors).toHaveLength(1);
  expect(result.success).toBe(false);
});
