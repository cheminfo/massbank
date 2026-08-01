/**
 * MassBank validation library
 * Main entry point for the package
 */

export * from './validator/validate.ts';
export * from './validator/validateContent.ts';
export * from './get-variables.ts';
export * from './splash/index.ts';

// Builder surface. Exported so consumers can construct records rather than
// hand-rolling the format.
export { ParseException } from './parser/exceptions.ts';
export { parseRecord } from './parser/parse-record.ts';
export { serializeRecord } from './serializer/record-serializer.ts';
export * from './builder/index.ts';

export type { Annotation, MassBankRecord, Peak } from './record.ts';

// Types for reading validation results
export type {
  ParseError,
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from './types.js';
