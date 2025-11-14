import type { Record } from '../record.js';

import { ParseException } from './exceptions.js';
import {
  AnalyticalConditionsFieldParser,
  CompoundFieldParser,
  HeaderFieldParser,
  MassSpectrometryFieldParser,
  PeakFieldParser,
  SpeciesFieldParser,
} from './field-parsers.js';
import type {
  IFieldParser,
  IRecordParser,
  ITableParser,
} from './interfaces.js';
import { PositionUtils } from './position-utils.js';
import { AnnotationTableParser, PeakTableParser } from './table-parsers.js';

/**
 * Main MassBank record parser
 * responsible for parsing
 * Uses interfaces for field/table parsers
 * Easy to extend with new parsers
 */
export class RecordParser implements IRecordParser {
  private readonly fieldParsers: IFieldParser[];
  private readonly tableParsers: ITableParser[];

  constructor() {
    // Initialize parsers (could be injected via DI in the future)
    this.fieldParsers = [
      new HeaderFieldParser(),
      new CompoundFieldParser(),
      new AnalyticalConditionsFieldParser(),
      new MassSpectrometryFieldParser(),
      new PeakFieldParser(),
      new SpeciesFieldParser(),
    ];

    this.tableParsers = [new PeakTableParser(), new AnnotationTableParser()];
  }

  /**
   * Parse a MassBank record string into a Record object
   * @param text
   */
  parse(text: string): Record {
    const lines = text.split(/\r?\n/);
    const record: Record = {
      ACCESSION: '',
    };

    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        i++;
        continue;
      }

      // Check for record terminator
      if (trimmed === '//') {
        break;
      }

      // Parse key-value pairs
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        // Line without colon is invalid unless we're in a table context
        // (which is handled by table parsers before we get here)
        throw new ParseException(
          PositionUtils.createParseError(
            text,
            PositionUtils.getPosition(lines, i + 1, 1),
            'Invalid line format: expected "KEY: value" or table data',
          ),
        );
      }

      const key = line.slice(0, Math.max(0, colonIndex)).trim();
      const value = line.slice(Math.max(0, colonIndex + 1)).trim();

      // Try table parsers first (they handle multi-line data)
      const tableParser = this.tableParsers.find((p) => p.canParse(key));
      if (tableParser) {
        const headerLine = line; // Current line is the header
        i++; // Skip header line
        const linesConsumed = tableParser.parse(
          key,
          lines,
          i,
          record,
          headerLine,
        );
        i += linesConsumed;
        continue;
      }

      // Try field parsers
      const fieldParser = this.fieldParsers.find((p) => p.canParse(key));
      if (fieldParser) {
        try {
          fieldParser.parse(key, value, record);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown parsing error';
          throw new ParseException(
            PositionUtils.createParseError(
              text,
              PositionUtils.getPosition(lines, i + 1, colonIndex + 2),
              message,
            ),
          );
        }
      }

      i++;
    }

    if (!record.ACCESSION) {
      throw new ParseException(
        PositionUtils.createParseError(text, 0, 'ACCESSION field is required'),
      );
    }

    return record;
  }
}

/**
 * Factory function to create a parser instance
 * Follows Factory Pattern
 */
export function createParser(): IRecordParser {
  return new RecordParser();
}

/**
 * Convenience function to parse a record
 * @param text
 */
export function parseRecord(text: string): Record {
  const parser = createParser();
  return parser.parse(text);
}
