/**
 * My module
 * @param text
 * @param options
 * @returns A very important number
 */
export function isValid(text: string, options = {}): boolean {
  const { logger } = options;

  console.log(logger);
  if (logger) {
    logger.info('you forget a abc');
  }

  return true;
}
