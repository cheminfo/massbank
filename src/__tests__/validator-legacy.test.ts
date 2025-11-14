import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validate } from '../validator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test files are in the tests/data directory
const TEST_FILES_DIR = join(__dirname, '../../tests/data');

describe('MassBankValidator - Legacy Mode', () => {
  it('should validate in legacy mode', async () => {
    const result = await validate(
      join(TEST_FILES_DIR, 'MSBNK-test-TST00001.txt'),
      { legacy: true },
    );

    // Legacy mode should still validate successfully for valid files
    expect(result.success).toBe(true);
  });

  it('should be less strict in legacy mode', async () => {
    // This test would need a file with minor issues that legacy mode allows
    // For now, just verify legacy option is accepted
    const result = await validate(TEST_FILES_DIR, { legacy: true });

    expect(result.filesProcessed).toBeGreaterThan(0);
  });
});
