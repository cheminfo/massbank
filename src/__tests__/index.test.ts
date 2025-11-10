import { expect, test } from 'vitest';

import { parseRecord, validate } from '../index.ts';

test('should export parseRecord', () => {
  const record = parseRecord('ACCESSION: TEST\n//');

  expect(record.ACCESSION).toBe('TEST');
});

test('should export validate function', async () => {
  // This is a basic smoke test
  expect(typeof validate).toBe('function');
});
