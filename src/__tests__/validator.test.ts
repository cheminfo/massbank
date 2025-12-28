import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validate, validateContent } from '../validator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests/data directory
const TEST_FILES_DIR = join(__dirname, '../../tests/data');

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

  it('should return errors for invalid file', async () => {
    const invalidContent = 'INVALID CONTENT WITHOUT ACCESSION\n//';
    const tempDir = join(__dirname, '../__temp_test_files__');
    const { mkdir, writeFile, unlink } = await import('node:fs/promises');
    await mkdir(tempDir, { recursive: true }).catch(() => {
      // Ignore if directory already exists
    });
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

describe('validateContent (browser-compatible)', () => {
  it('should validate content string successfully', async () => {
    // Read file content manually (simulates browser File.text())
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );

    // Use validateContent with just the filename (no filesystem access)
    const result = await validateContent(content, 'MSBNK-test-TST00001.txt');

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.accessions).toContain('MSBNK-test-TST00001');
    expect(result.filesProcessed).toBe(1);
  });

  it('should work with Unix-style path as filename', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );

    // Browser might pass full path from file input
    const result = await validateContent(
      content,
      '/uploads/MSBNK-test-TST00001.txt',
    );

    expect(result.success).toBe(true);
    expect(result.accessions).toContain('MSBNK-test-TST00001');
  });

  it('should work with Windows-style path as filename', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );

    // Windows browser might include full path
    const result = await validateContent(
      content,
      String.raw`C:\Users\test\MSBNK-test-TST00001.txt`,
    );

    expect(result.success).toBe(true);
    expect(result.accessions).toContain('MSBNK-test-TST00001');
  });

  it('should return errors for invalid content', async () => {
    const invalidContent = 'INVALID CONTENT WITHOUT ACCESSION\n//';

    const result = await validateContent(invalidContent, 'test.txt');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should detect accession-filename mismatch', async () => {
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );

    // Filename doesn't match the ACCESSION in the content
    const result = await validateContent(content, 'wrong-name.txt');

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('ACCESSION'))).toBe(
      true,
    );
  });

  it('should handle complex records with multiple fields', async () => {
    // TST00002 is a more complex record with many fields
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00002.txt'),
      'utf8',
    );

    const result = await validateContent(content, 'MSBNK-test-TST00002.txt');

    expect(result.success).toBe(true);
    expect(result.accessions).toContain('MSBNK-test-TST00002');
  });

  it('should work without any Node.js path module', async () => {
    // This test verifies the browser-compatible path handling works
    // by using filenames that would fail with incorrect path parsing
    const content = await readFile(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      'utf8',
    );

    // Test various path formats that browsers might provide
    const pathFormats = [
      'MSBNK-test-TST00001.txt', // Just filename
      '/MSBNK-test-TST00001.txt', // Unix root
      './MSBNK-test-TST00001.txt', // Relative
      'folder/MSBNK-test-TST00001.txt', // Unix subfolder
      String.raw`folder\MSBNK-test-TST00001.txt`, // Windows subfolder
    ];

    const results = await Promise.all(
      pathFormats.map((filename) => validateContent(content, filename)),
    );

    for (const result of results) {
      expect(result.success).toBe(true);

      expect(result.accessions).toContain('MSBNK-test-TST00001');
    }
  });
});
