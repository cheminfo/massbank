import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ParseException, parseRecord } from '../parser/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests directory
const TEST_FILES_DIR = join(__dirname, '../../tests/recordfiles');

describe('RecordParser', () => {
  it('should parse a valid record file', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(content);

    expect(record.ACCESSION).toBe('MSBNK-test-TST00001');
    expect(record.RECORD_TITLE).toBe(
      'Fiscalin C; LC-ESI-ITFT; MS2; CE: 30; R=17500; [M+H]+',
    );
    expect(record.DATE).toBe('2017.07.07');
    expect(record.CH$NAME).toEqual(['Fiscalin C']);
    expect(record.PK$NUM_PEAK).toBe(3);
    expect(record.PK$PEAK).toHaveLength(3);
    expect(record.PK$PEAK![0]?.mz).toBe(185.1073);
  });

  it('should parse record with multiple CH$NAME fields', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00002.txt'),
      'utf8',
    );
    const record = parseRecord(content);

    expect(record.CH$NAME).toEqual([
      'Disialoganglioside GD1a',
      'another name',
    ]);
  });

  it('should parse record with annotations', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
      'utf8',
    );
    const record = parseRecord(content);

    expect(record.PK$ANNOTATION).toBeDefined();
    expect(record.PK$ANNOTATION!.length).toBeGreaterThan(0);
    expect(record.PK$ANNOTATION![0]?.mz).toBe(59.013471921284996);
  });

  it('should parse deprecated records', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
      'utf8',
    );
    const record = parseRecord(content);

    expect(record.DEPRECATED).toBe('2019-11-25 Wrong MS measurement assigned');
  });

  it('should throw ParseException for missing ACCESSION', () => {
    const content = 'RECORD_TITLE: Test\n//';

    expect(() => parseRecord(content)).toThrow(ParseException);
  });

  it('should throw ParseException for invalid format', () => {
    const content = 'ACCESSION: TEST\nINVALID LINE WITHOUT COLON\n//';

    expect(() => parseRecord(content)).toThrow(ParseException);
  });

  it('should parse all three test files successfully', async () => {
    const files = [
      'MSBNK-test-TST00001.txt',
      'MSBNK-test-TST00002.txt',
      'MSBNK-test-TST00003.txt',
    ];

    const records = await Promise.all(
      files.map(async (file) => {
        const content = await readFile(join(TEST_FILES_DIR, file), 'utf8');
        return parseRecord(content);
      }),
    );

    for (const record of records) {
      expect(record.ACCESSION.length).toBeGreaterThan(0);
      expect(typeof record.ACCESSION).toBe('string');
    }
  });
});
