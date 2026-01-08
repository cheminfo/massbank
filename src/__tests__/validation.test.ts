import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseRecord } from '../parser/index.js';
import {
  AccessionMatchRule,
  NonStandardCharsRule,
  SerializationRule,
} from '../validation/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests/data directory
const TEST_FILES_DIR = join(__dirname, '../../tests/data');

describe('AccessionMatchRule', () => {
  it('should validate matching accession and filename', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(content);
    const rule = new AccessionMatchRule();

    const errors = rule.validate(
      record,
      content,
      'MSBNK-test-TST00001.txt',
      {},
    );

    expect(errors).toHaveLength(0);
  });

  it('should error on mismatched accession and filename', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(content);
    const rule = new AccessionMatchRule();

    const errors = rule.validate(record, content, 'wrong-filename.txt', {});

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.type).toBe('validation');
  });

  // Browser-compatible path handling tests
  describe('browser-compatible path handling', () => {
    it('should extract filename from Unix-style path', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      // Unix-style path
      const errors = rule.validate(
        record,
        content,
        '/some/path/to/MSBNK-test-TST00001.txt',
        {},
      );

      expect(errors).toHaveLength(0);
    });

    it('should extract filename from Windows-style path', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      // Windows-style path
      const errors = rule.validate(
        record,
        content,
        String.raw`C:\Users\test\MSBNK-test-TST00001.txt`,
        {},
      );

      expect(errors).toHaveLength(0);
    });

    it('should handle filename without path', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      // Just filename, no path
      const errors = rule.validate(
        record,
        content,
        'MSBNK-test-TST00001.txt',
        {},
      );

      expect(errors).toHaveLength(0);
    });

    it('should handle mixed path separators', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      // Mixed separators (can happen in some environments)
      const errors = rule.validate(
        record,
        content,
        String.raw`some/path\to/MSBNK-test-TST00001.txt`,
        {},
      );

      expect(errors).toHaveLength(0);
    });

    it('should correctly remove .txt extension', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      const errors = rule.validate(
        record,
        content,
        'MSBNK-test-TST00001.txt',
        {},
      );

      expect(errors).toHaveLength(0);
    });

    it('should handle filename with multiple dots', async () => {
      const content = await readFile(
        join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
        'utf8',
      );
      const record = parseRecord(content);
      const rule = new AccessionMatchRule();

      // Filename that would have multiple dots - should only remove last extension
      // Here we test that MSBNK-test-TST00001 matches even with weird path
      const errors = rule.validate(
        record,
        content,
        '/path.with.dots/MSBNK-test-TST00001.txt',
        {},
      );

      expect(errors).toHaveLength(0);
    });
  });
});

describe('NonStandardCharsRule', () => {
  it('should not warn on standard characters', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(content);
    const rule = new NonStandardCharsRule();

    const warnings = rule.getWarnings(record, content, 'test.txt', {});

    expect(warnings).toHaveLength(0);
  });

  it('should skip deprecated records', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
      'utf8',
    );
    const record = parseRecord(content);
    const rule = new NonStandardCharsRule();

    const warnings = rule.getWarnings(record, content, 'test.txt', {});

    // Deprecated records should be skipped
    expect(warnings).toHaveLength(0);
  });
});

describe('SerializationRule', () => {
  it('should validate serialization round-trip', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );
    const record = parseRecord(content);
    const rule = new SerializationRule();

    const errors = rule.validate(record, content, 'test.txt', {});

    expect(errors).toHaveLength(0);
  });
});
