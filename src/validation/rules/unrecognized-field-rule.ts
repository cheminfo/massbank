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
        warnings.push({
          file: filename,
          line: i + 1,
          message: `Unrecognized field '${key}'. This may be a typo or an unsupported field.`,
        });
      }
    }

    return warnings;
  }
}
