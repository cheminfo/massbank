import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { parseRecord } from '../parser/index.ts';
import { serializeRecord } from '../serializer/index.ts';

const __dirname = import.meta.dirname;

// Test files are in the tests/data directory
const TEST_FILES_DIR = join(__dirname, './data');

test('should serialize and round-trip TST00001', async () => {
  const original = await readFile(
    join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
    'utf8',
  );
  const record = parseRecord(original);
  const serialized = serializeRecord(record);
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const normalizedOriginal = original.replace(/\r\n?/g, '\n');

  expect(serialized).toBe(normalizedOriginal);
});

test('should serialize and round-trip TST00002', async () => {
  const original = await readFile(
    join(TEST_FILES_DIR, 'MSBNK-test-TST00002.txt'),
    'utf8',
  );
  const record = parseRecord(original);
  const serialized = serializeRecord(record);
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const normalizedOriginal = original.replace(/\r\n?/g, '\n');

  expect(serialized).toBe(normalizedOriginal);
});

test('should serialize and round-trip TST00003', async () => {
  const original = await readFile(
    join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
    'utf8',
  );
  const record = parseRecord(original);
  const serialized = serializeRecord(record);
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const normalizedOriginal = original.replace(/\r\n?/g, '\n');

  expect(serialized).toBe(normalizedOriginal);
});

test('should preserve all fields in serialization', async () => {
  const original = await readFile(
    join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
    'utf8',
  );
  const record = parseRecord(original);
  const serialized = serializeRecord(record);
  const reParsed = parseRecord(serialized);

  expect(reParsed).toStrictEqual(record);
});
