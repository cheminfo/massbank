import type { Record } from '../record.js';

/**
 * Interface for parsing MassBank records
 */
export interface IRecordParser {
  /**
   * Parse a MassBank record string into a Record object
   * @param text - The MassBank record text
   * @returns The parsed Record object
   * @throws {import('./exceptions.js').ParseException} if parsing fails
   */
  parse(text: string): Record;
}

/**
 * Interface for parsing field values
 */
export interface IFieldParser {
  /**
   * Check if this parser can handle the given key
   */
  canParse(key: string): boolean;

  /**
   * Parse the field value
   */
  parse(key: string, value: string, record: Record): void;
}

/**
 * Interface for parsing table data (peaks, annotations)
 */
export interface ITableParser {
  /**
   * Check if this parser can handle the given key
   */
  canParse(key: string): boolean;

  /**
   * Parse table data starting from the given line index
   * @param key - The field key
   * @param lines - All lines
   * @param startIndex - Index of first data line (header is at startIndex - 1)
   * @param record - Record to populate
   * @param headerLine - The full header line (e.g., "PK$ANNOTATION: m/z ion")
   * @returns The number of lines consumed
   */
  parse(
    key: string,
    lines: string[],
    startIndex: number,
    record: Record,
    headerLine?: string,
  ): number;
}
