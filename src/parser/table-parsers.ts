import type { Annotation, Peak, Record } from '../record.js';

import type { ITableParser } from './interfaces.js';

/**
 * Base class for table parsers
 */
abstract class BaseTableParser implements ITableParser {
  abstract canParse(key: string): boolean;
  abstract parse(
    key: string,
    lines: string[],
    startIndex: number,
    record: Record,
    headerLine?: string,
  ): number;
}

/**
 * Peak table parser
 */
export class PeakTableParser extends BaseTableParser {
  canParse(key: string): boolean {
    return key === 'PK$PEAK';
  }

  parse(
    key: string,
    lines: string[],
    startIndex: number,
    record: Record,
    _headerLine?: string,
  ): number {
    void _headerLine;
    const peaks: Peak[] = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i]?.trim();
      if (!line || line === '//') {
        break;
      }
      // Check if this is a new key-value pair (next section)
      if (line.includes(':')) {
        break;
      }
      const peak = this.parsePeakLine(line);
      if (peak) {
        peaks.push(peak);
      }
      i++;
    }

    record.PK$PEAK = peaks;
    return i - startIndex;
  }

  private parsePeakLine(line: string): Peak | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) {
      return null;
    }

    const first = parts[0];
    const second = parts[1];
    if (first === undefined || second === undefined) {
      return null;
    }

    const mz = Number.parseFloat(first);
    const intensity = Number.parseFloat(second);
    const third = parts.length >= 3 ? parts[2] : undefined;
    const relativeIntensity =
      third !== undefined ? Number.parseFloat(third) : 0;

    if (Number.isNaN(mz) || Number.isNaN(intensity)) {
      return null;
    }

    return {
      mz,
      intensity,
      relativeIntensity: Number.isNaN(relativeIntensity)
        ? 0
        : relativeIntensity,
      _original: {
        mz: first,
        intensity: second,
        relativeIntensity: third ?? '0',
      },
    };
  }
}

/**
 * Annotation table parser
 */
export class AnnotationTableParser extends BaseTableParser {
  canParse(key: string): boolean {
    return key === 'PK$ANNOTATION';
  }

  parse(
    key: string,
    lines: string[],
    startIndex: number,
    record: Record,
    headerLine?: string,
  ): number {
    const annotations: Annotation[] = [];
    // Store the header line value (the part after the colon)
    if (headerLine) {
      const colonIndex = headerLine.indexOf(':');
      if (colonIndex !== -1) {
        record._PK$ANNOTATION_HEADER = headerLine
          .slice(Math.max(0, colonIndex + 1))
          .trim();
      }
    }
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i]?.trim();
      if (!line || line === '//') {
        break;
      }
      // Check if this is a new key-value pair (next section)
      if (line.includes(':')) {
        break;
      }
      const annotation = this.parseAnnotationLine(line);
      if (annotation) {
        annotations.push(annotation);
      }
      i++;
    }

    record.PK$ANNOTATION = annotations;
    return i - startIndex;
  }

  private parseAnnotationLine(line: string): Annotation | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 0) {
      return null;
    }

    const first = parts[0];
    if (first === undefined) {
      return null;
    }

    const mz = Number.parseFloat(first);
    if (Number.isNaN(mz)) {
      return null;
    }

    const annotation: Annotation = {
      mz,
      _original: line.trim(),
    };

    // Format: m/z annotation exact_mass error(ppm)
    // The header tells us the format, so we parse accordingly
    // If we have 4 parts, it's: m/z, annotation, exact_mass, error
    // If we have 3 parts, it could be: m/z, annotation, exact_mass OR m/z, annotation, error
    // If we have 2 parts, it's: m/z, annotation
    if (parts.length >= 2) {
      const secondPart = parts[1];
      if (secondPart === undefined) {
        return annotation;
      }
      // Check if second part could be a number (but might still be annotation text like "precursor")
      // We'll treat it as annotation if there are 4 parts (since format is m/z annotation exact_mass error)
      if (parts.length === 4) {
        // Format: m/z annotation exact_mass error
        const third = parts[2];
        const fourth = parts[3];
        if (third === undefined || fourth === undefined) {
          return annotation;
        }
        annotation.annotation = secondPart;
        annotation.exactMass = Number.parseFloat(third);
        annotation.errorPpm = Number.parseFloat(fourth);
      } else if (parts.length === 3) {
        // Could be m/z annotation exact_mass or m/z annotation error
        // Check if third part is a number - if so, it's exact_mass
        const third = parts[2];
        if (third === undefined) {
          return annotation;
        }
        const thirdAsNumber = Number.parseFloat(third);
        if (!Number.isNaN(thirdAsNumber)) {
          // Check if second is also a number - if both are numbers, second is exact_mass
          const secondAsNumber = Number.parseFloat(secondPart);
          if (!Number.isNaN(secondAsNumber)) {
            // Both are numbers: m/z exact_mass error
            annotation.exactMass = secondAsNumber;
            annotation.errorPpm = thirdAsNumber;
          } else {
            // Second is text, third is number: m/z annotation exact_mass
            annotation.annotation = secondPart;
            annotation.exactMass = thirdAsNumber;
          }
        } else {
          // Third is not a number, treat second as annotation text
          annotation.annotation = secondPart;
        }
      } else {
        // 2 parts: m/z annotation
        annotation.annotation = secondPart;
      }
    }

    return annotation;
  }
}
