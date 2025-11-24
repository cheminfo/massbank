import { expect, test } from 'vitest';

import { validate, validateContent } from '../index.js';
import { parseRecord } from '../parser/index.js';

test('should parse records internally', () => {
  const record = parseRecord('ACCESSION: TEST\n//');

  expect(record.ACCESSION).toBe('TEST');
});

test('should export validate function', () => {
  expect(typeof validate).toBe('function');
});

test('should export validateContent function', () => {
  expect(typeof validateContent).toBe('function');
});
