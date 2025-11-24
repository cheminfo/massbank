/**
 * MassBank validation library
 * Main entry point for the package
 */

// Validation functions
export { validate, validateContent } from './validator/index.js';

// Types for reading validation results
export type {
  ValidationError,
  ValidationOptions,
  ValidationResult,
  ValidationWarning,
} from './types.js';
