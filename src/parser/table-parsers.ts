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

    const mz = Number.parseFloat(parts[0]!);
    const intensity = Number.parseFloat(parts[1]!);
    const relativeIntensity = parts.length >= 3 ? Number.parseFloat(parts[2]!) : 0;

    if (isNaN(mz) || isNaN(intensity)) {
      return null;
    }

    return {
      mz,
      intensity,
      relativeIntensity: isNaN(relativeIntensity) ? 0 : relativeIntensity,
      _original: {
        mz: parts[0]!,
        intensity: parts[1]!,
        relativeIntensity: parts.length >= 3 ? parts[2]! : '0',
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

    const mz = Number.parseFloat(parts[0]!);
    if (isNaN(mz)) {
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
      const secondPart = parts[1]!;
      // Check if second part could be a number (but might still be annotation text like "precursor")
      // We'll treat it as annotation if there are 4 parts (since format is m/z annotation exact_mass error)
      if (parts.length === 4) {
        // Format: m/z annotation exact_mass error
        annotation.annotation = secondPart;
        annotation.exactMass = Number.parseFloat(parts[2]!);
        annotation.errorPpm = Number.parseFloat(parts[3]!);
      } else if (parts.length === 3) {
        // Could be m/z annotation exact_mass or m/z annotation error
        // Check if third part is a number - if so, it's exact_mass
        const thirdAsNumber = Number.parseFloat(parts[2]!);
        if (!isNaN(thirdAsNumber)) {
          // Check if second is also a number - if both are numbers, second is exact_mass
          const secondAsNumber = Number.parseFloat(secondPart);
          if (!isNaN(secondAsNumber)) {
            // Both are numbers: m/z exact_mass error
            annotation.exactMass = secondAsNumber;
            annotation.errorPpm = thirdAsNumber;
          } else {
            // Second is text, third is number: m/z annotation exact_mass
            annotation.annotation = secondPart;
            annotation.exactMass = thirdAsNumber;
          }
        } else {
          // Third is not a number: m/z annotation error (unlikely but handle it)
          annotation.annotation = secondPart;
          annotation.errorPpm = Number.parseFloat(parts[2]!);
        }
      } else {
        // 2 parts: m/z annotation
        annotation.annotation = secondPart;
      }
    }

    return annotation;
  }
}
