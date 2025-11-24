import type { FifoLogger } from 'fifo-logger';

export interface ValidationOptions {
  /**
   * Enable legacy mode for less strict validation (for legacy records with minor problems)
   */
  legacy?: boolean;
  /**
   * Optional logger for validation messages
   */
  logger?: FifoLogger;
}

export interface ValidationError {
  /**
   * File path where the error occurred
   */
  file: string;
  /**
   * Line number (1-based)
   */
  line?: number;
  /**
   * Column number (1-based)
   */
  column?: number;
  /**
   * Error message
   */
  message: string;
  /**
   * Error type/category
   */
  type: 'parse' | 'validation' | 'serialization' | 'duplicate' | 'other';
}

export interface ValidationWarning {
  /**
   * File path where the warning occurred
   */
  file: string;
  /**
   * Line number (1-based)
   */
  line?: number;
  /**
   * Column number (1-based)
   */
  column?: number;
  /**
   * Warning message
   */
  message: string;
}

export interface ValidationResult {
  /**
   * Whether validation was successful (no errors)
   */
  success: boolean;
  /**
   * List of validation errors
   */
  errors: ValidationError[];
  /**
   * List of validation warnings
   */
  warnings: ValidationWarning[];
  /**
   * List of accessions found in validated files
   */
  accessions: string[];
  /**
   * Number of files processed
   */
  filesProcessed: number;
}

export interface ParseError {
  /**
   * Character position in the input string
   */
  position: number;
  /**
   * Error message
   */
  message: string;
  /**
   * Line number (1-based)
   */
  line: number;
  /**
   * Column number (1-based)
   */
  column: number;
}
