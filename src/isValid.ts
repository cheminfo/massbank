import type { FifoLogger } from 'fifo-logger';

export interface IsValidOptions {
  logger?: FifoLogger;
}

/**
 * Check if massbank file is valid
 * @param text
 * @param options
 * @returns A very important number
 */
export function isValid(text: string, options: IsValidOptions = {}): boolean {
  const { logger } = options;

  console.log(logger);
  if (logger) {
    logger.info('you forget a abc');
  }

  return true;
}
