import type { Record } from '../../record.js';
import type { ValidationWarning } from '../../types.js';
import type { IValidationRule, ValidationRuleOptions } from '../interfaces.js';

/**
 * Validation rule that warns about unrecognized fields
 * Helps catch typos and unsupported field names
 */
export class UnrecognizedFieldRule implements IValidationRule {
  /**
   * List of all recognized MassBank 2.6.0 field names
   */
  private readonly recognizedFields = new Set([
    // Header fields
    'ACCESSION',
    'RECORD_TITLE',
    'DATE',
    'AUTHORS',
    'LICENSE',
    'COPYRIGHT',
    'PUBLICATION',
    'PROJECT',
    'COMMENT',
    'DEPRECATED',
    // Chemical compound fields
    'CH$NAME',
    'CH$COMPOUND_CLASS',
    'CH$FORMULA',
    'CH$EXACT_MASS',
    'CH$SMILES',
    'CH$IUPAC',
    'CH$LINK',
    // Analytical chemistry fields
    'AC$INSTRUMENT',
    'AC$INSTRUMENT_TYPE',
    'AC$MASS_SPECTROMETRY',
    'AC$CHROMATOGRAPHY',
    // Mass spectrometry fields
    'MS$FOCUSED_ION',
    'MS$DATA_PROCESSING',
    // Peak data fields
    'PK$SPLASH',
    'PK$NUM_PEAK',
    'PK$PEAK',
    'PK$ANNOTATION',
    // Sample/species fields
    'SP$SCIENTIFIC_NAME',
    'SP$LINEAGE',
    'SP$LINK',
    'SP$SAMPLE',
  ]);

  validate(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _record: Record,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _originalText: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: ValidationRuleOptions,
  ): never[] {
    // This rule only produces warnings, not errors
    return [];
  }

  getWarnings(
    _record: Record,
    originalText: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: ValidationRuleOptions,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const lines = originalText.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line || line === '//' || line.startsWith('//')) {
        continue;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }

      const key = line.slice(0, colonIndex).trim();

      // Check if this is an unrecognized field
      if (!this.recognizedFields.has(key)) {
        // Suggest similar field names for common typos
        const suggestion = this.findSimilarField(key);
        let message = `Unrecognized field '${key}'. Not a valid MassBank 2.6.0 field.`;

        if (suggestion) {
          message += ` Did you mean '${suggestion}'?`;
        } else {
          message += ' Remove this line or check the MassBank format specification.';
        }

        warnings.push({
          file: filename,
          line: i + 1,
          message,
        });
      }
    }

    return warnings;
  }

  /**
   * Find a similar field name for typo suggestions
   * Uses simple Levenshtein distance for similarity
   */
  private findSimilarField(input: string): string | null {
    let bestMatch: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const field of this.recognizedFields) {
      const distance = this.levenshteinDistance(input, field);
      // Only suggest if very similar (distance <= 2)
      if (distance <= 2 && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = field;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1, // substitution
            matrix[i]![j - 1]! + 1,     // insertion
            matrix[i - 1]![j]! + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length]![a.length]!;
  }
}
