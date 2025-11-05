import { FifoLogger } from 'fifo-logger';
import { expect, test } from 'vitest';

import { isValid } from '../isValid.ts';

test('should return 42', () => {
  const logger = new FifoLogger({ level: 'info' });

  expect(isValid('abc', { logger })).toBe(true);

  const logs = logger.getLogs();
  for (const log of logs) {
    delete log.uuids;
    delete log.time;
  }

  expect(logs).toStrictEqual([
    {
      id: 1,
      level: 30,
      levelLabel: 'info',
      message: 'you forget a abc',
      meta: {},
    },
  ]);

  expect(logs).toMatchSnapshot();
});
