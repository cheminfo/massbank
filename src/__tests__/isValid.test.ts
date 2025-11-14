import { FifoLogger } from 'fifo-logger';
import { expect, test } from 'vitest';

import { isValid } from '../isValid.ts';

test('should validate a valid record', async () => {
  const logger = new FifoLogger({ level: 'info' });
  // Include trailing newline to match file format
  const validRecord = 'ACCESSION: TEST-001\nRECORD_TITLE: Test Record\n//\n';

  const result = await isValid(validRecord, { logger });

  expect(result).toBe(true);
});

test('should reject an invalid record', async () => {
  const logger = new FifoLogger({ level: 'info' });
  const invalidRecord = 'INVALID CONTENT';

  const result = await isValid(invalidRecord, { logger });

  expect(result).toBe(false);
});
