import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validate } from '../validator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests directory
const TEST_FILES_DIR = join(__dirname, '../../tests/recordfiles');

describe('MassBankValidator', () => {
  it('should validate a single file successfully', async () => {
    const result = await validate(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
    );

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.accessions).toContain('MSBNK-test-TST00001');
    expect(result.filesProcessed).toBe(1);
  });

  it('should validate a directory successfully', async () => {
    const result = await validate(TEST_FILES_DIR);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.accessions.length).toBeGreaterThanOrEqual(3);
    expect(result.filesProcessed).toBeGreaterThanOrEqual(3);
  });

  it('should validate multiple files', async () => {
    const files = [
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      join(TEST_FILES_DIR, 'MSBNK-test-TST00002.txt'),
      join(TEST_FILES_DIR, 'MSBNK-test-TST00003.txt'),
    ];

    const result = await validate(files);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.accessions).toHaveLength(3);
    expect(result.filesProcessed).toBe(3);
  });

  it('should return errors for invalid file', async () => {
    const invalidContent = 'INVALID CONTENT WITHOUT ACCESSION\n//';
    const tempDir = join(__dirname, '../__temp_test_files__');
    const { mkdir, writeFile, unlink } = await import('node:fs/promises');
    await mkdir(tempDir, { recursive: true }).catch(() => {});
    const tempFile = join(tempDir, 'invalid-test.txt');

    // Write invalid content temporarily
    await writeFile(tempFile, invalidContent);

    try {
      const result = await validate(tempFile);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      // Clean up
      await unlink(tempFile).catch(() => {
        // Ignore cleanup errors
      });
    }
  });

  it('should handle non-existent file gracefully', async () => {
    const result = await validate('non-existent-file.txt');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
