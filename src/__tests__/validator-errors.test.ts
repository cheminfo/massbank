import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { validate } from '../validator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use a temp directory for test files we create
const TEMP_TEST_DIR = join(__dirname, '../__temp_test_files__');

describe('MassBankValidator - Error Handling', () => {
  // Ensure temp directory exists
  beforeAll(async () => {
    try {
      await mkdir(TEMP_TEST_DIR, { recursive: true });
    } catch {
      // Directory might already exist
    }
  });

  it('should handle missing ACCESSION field', async () => {
    const invalidContent = 'RECORD_TITLE: Test Record\n//';
    const tempFile = join(TEMP_TEST_DIR, 'no-accession-test.txt');

    await writeFile(tempFile, invalidContent);

    try {
      const result = await validate(tempFile);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.type === 'parse')).toBe(true);
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  });

  it('should handle mismatched ACCESSION and filename', async () => {
    const content = `ACCESSION: WRONG-ACCESSION
RECORD_TITLE: Test
//`;
    const tempFile = join(TEMP_TEST_DIR, 'mismatch-test.txt');

    await writeFile(tempFile, content);

    try {
      const result = await validate(tempFile);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes('ACCESSION'))).toBe(
        true,
      );
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  });

  it('should handle duplicate accessions', async () => {
    const content1 = `ACCESSION: DUPLICATE-TEST
RECORD_TITLE: Test 1
//`;
    const content2 = `ACCESSION: DUPLICATE-TEST
RECORD_TITLE: Test 2
//`;

    const tempFile1 = join(TEMP_TEST_DIR, 'duplicate-1.txt');
    const tempFile2 = join(TEMP_TEST_DIR, 'duplicate-2.txt');

    await writeFile(tempFile1, content1);
    await writeFile(tempFile2, content2);

    try {
      const result = await validate([tempFile1, tempFile2]);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === 'duplicate')).toBe(true);
    } finally {
      await unlink(tempFile1).catch(() => {});
      await unlink(tempFile2).catch(() => {});
    }
  });

  it('should handle empty directory', async () => {
    const result = await validate('non-existent-directory/');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.filesProcessed).toBe(0);
  });
});
