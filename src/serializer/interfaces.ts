import type { Record } from '../record.js';

/**
 * Interface for serializing MassBank records
 * Follows Dependency Inversion Principle
 */
export interface IRecordSerializer {
  /**
   * Serialize a Record object to MassBank record string format
   * @param record - The record to serialize
   * @returns The serialized record string
   */
  serialize(record: Record): string;
}
