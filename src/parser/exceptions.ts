import type { ParseError } from '../types.js';

/**
 * Exception thrown when parsing fails
 */
export class ParseException extends Error {
  readonly parseError: ParseError;
  constructor(parseError: ParseError, message?: string) {
    super(message || parseError.message);
    this.parseError = parseError;
    this.name = 'ParseException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    const ErrorConstructor = Error as typeof Error & {
      captureStackTrace?: (
        error: Error,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor: new (...args: any[]) => Error,
      ) => void;
    };
    if (typeof ErrorConstructor.captureStackTrace === 'function') {
      ErrorConstructor.captureStackTrace(this, ParseException);
    }
  }
}
