/**
 * MassBank validation library
 * Main entry point for the package
 */

// Main validation functions
export {
  MassBankValidator,
  createValidator,
  validate,
} from './validator/index.js';

// Parser functions
export { RecordParser, createParser, parseRecord } from './parser/index.js';
export { ParseException } from './parser/exceptions.js';

// Serializer functions
export {
  RecordSerializer,
  createSerializer,
  serializeRecord,
} from './serializer/index.js';

// Types
export type {
  ParseError,
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from './types.js';

export type { Annotation, Peak, Record } from './record.js';

// Validation rules (for extensibility)
export type {
  IValidationRule,
  ValidationRuleOptions,
} from './validation/interfaces.js';
export * from './validation/rules/index.js';

// SPLASH
export { SplashValidator, createSplashValidator } from './splash/index.js';
export type { ISplashValidator } from './splash/interfaces.js';

// Backward compatibility
export { isValid } from './isValid.js';
