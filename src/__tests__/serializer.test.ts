import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseRecord } from '../parser/index.js';
import { serializeRecord } from '../serializer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests/data directory
const TEST_FILES_DIR = join(__dirname, '../../tests/data');

describe('RecordSerializer', () => {
  it('should serialize and round-trip TST00001', async () => {
    const original = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(original);
    const serialized = serializeRecord(record);
    const normalizedOriginal = original.replace(/\r\n?/g, '\n');

    expect(serialized).toBe(normalizedOriginal);
  });

  it('should serialize and round-trip TST00002', async () => {
    const original = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00002.txt'),
      'utf8',
    );
    const record = parseRecord(original);
    const serialized = serializeRecord(record);
    const normalizedOriginal = original.replace(/\r\n?/g, '\n');

    expect(serialized).toBe(normalizedOriginal);
  });

  it('should serialize and round-trip TST00003', async () => {
    const original = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
      'utf8',
    );
    const record = parseRecord(original);
    const serialized = serializeRecord(record);
    const normalizedOriginal = original.replace(/\r\n?/g, '\n');

    expect(serialized).toBe(normalizedOriginal);
  });

  it('should preserve all fields in serialization', async () => {
    const original = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(original);
    const serialized = serializeRecord(record);
    const reParsed = parseRecord(serialized);

    expect(reParsed.ACCESSION).toBe(record.ACCESSION);
    expect(reParsed.PK$PEAK).toStrictEqual(record.PK$PEAK);
  });
});
