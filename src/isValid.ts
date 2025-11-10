import type { FifoLogger } from 'fifo-logger';

export interface IsValidOptions {
  logger?: FifoLogger;
  /**
   * Enable legacy mode for less strict validation
   */
  legacy?: boolean;
}

/**
 * Check if massbank file is valid
 * Simplified boolean check wrapper around validate()
 * @param text - The MassBank record text
 * @param options - Validation options
 * @returns true if valid, false otherwise
 */
export async function isValid(
  text: string,
  options: IsValidOptions = {},
): Promise<boolean> {
  const { logger, legacy } = options;

  // For backward compatibility, we need to handle string input
  // We'll write to a temporary approach or use a different method
  // For now, we'll create a simple validation that works with text

  // Since validate() expects file paths, we need a different approach
  // We can parse and validate directly
  try {
    const { parseRecord } = await import('./parser/index.js');
    const { RecordValidator } = await import('./validation/index.js');
    const { serializeRecord } = await import('./serializer/index.js');

    // Parse the record
    const record = parseRecord(text);

    // Create a validator with default rules
    const validator = new RecordValidator();
    const rules = validator.getRules();

    // Apply validation rules (skip ACCESSION matching for string input)
    const validationOptions = { legacy };
    for (const rule of rules) {
      // Skip ACCESSION matching rule when validating from string (not file)
      if (rule.constructor.name === 'AccessionMatchRule') {
        continue;
      }
      const errors = rule.validate(record, text, '<string>', validationOptions);
      if (errors.length > 0) {
        if (logger) {
          for (const error of errors) {
            logger.warn(`Validation error: ${error.message}`);
          }
        }
        return false;
      }
    }

    // Check serialization round-trip
    const serialized = serializeRecord(record);
    const normalizedOriginal = text.replace(/\r\n?/g, '\n');
    // Normalize trailing newlines for comparison (both should end with \n)
    const normalizedOriginalTrimmed = `${normalizedOriginal.trimEnd()  }\n`;
    const serializedTrimmed = `${serialized.trimEnd()  }\n`;
    if (normalizedOriginalTrimmed !== serializedTrimmed) {
      if (logger) {
        logger.warn('Serialization round-trip failed');
      }
      return false;
    }

    return true;
  } catch (error) {
    if (logger) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Validation failed: ${message}`);
    }
    return false;
  }
}
