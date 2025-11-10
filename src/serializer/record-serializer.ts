import type { Record } from '../record.js';

import type { IRecordSerializer } from './interfaces.js';

/**
 * Serializes MassBank records to string format
 * Follows Single Responsibility Principle: Only responsible for serialization
 */
export class RecordSerializer implements IRecordSerializer {
  /**
   * Serialize a Record object to MassBank record string format
   * Maintains exact formatting for round-trip validation
   * @param record
   */
  serialize(record: Record): string {
    const lines: string[] = [];

    // Header fields - DEPRECATED must come right after ACCESSION
    lines.push(`ACCESSION: ${record.ACCESSION}`);
    if (record.DEPRECATED) {
      lines.push(`DEPRECATED: ${record.DEPRECATED}`);
    }
    if (record.RECORD_TITLE) {
      lines.push(`RECORD_TITLE: ${record.RECORD_TITLE}`);
    }
    if (record.DATE) {
      lines.push(`DATE: ${record.DATE}`);
    }
    if (record.AUTHORS) {
      lines.push(`AUTHORS: ${record.AUTHORS}`);
    }
    if (record.LICENSE) {
      lines.push(`LICENSE: ${record.LICENSE}`);
    }
    if (record.COPYRIGHT) {
      lines.push(`COPYRIGHT: ${record.COPYRIGHT}`);
    }
    if (record.PUBLICATION) {
      lines.push(`PUBLICATION: ${record.PUBLICATION}`);
    }
    if (record.PROJECT) {
      lines.push(`PROJECT: ${record.PROJECT}`);
    }
    if (record.COMMENT) {
      for (const comment of record.COMMENT) {
        lines.push(`COMMENT: ${comment}`);
      }
    }

    // CH$ section
    if (record.CH$NAME) {
      for (const name of record.CH$NAME) {
        lines.push(`CH$NAME: ${name}`);
      }
    }
    if (record.CH$COMPOUND_CLASS) {
      lines.push(`CH$COMPOUND_CLASS: ${record.CH$COMPOUND_CLASS}`);
    }
    if (record.CH$FORMULA) {
      lines.push(`CH$FORMULA: ${record.CH$FORMULA}`);
    }
    if (record.CH$EXACT_MASS) {
      lines.push(`CH$EXACT_MASS: ${record.CH$EXACT_MASS}`);
    }
    if (record.CH$SMILES) {
      lines.push(`CH$SMILES: ${record.CH$SMILES}`);
    }
    if (record.CH$IUPAC) {
      lines.push(`CH$IUPAC: ${record.CH$IUPAC}`);
    }
    if (record.CH$LINK) {
      for (const link of record.CH$LINK) {
        lines.push(`CH$LINK: ${link}`);
      }
    }

    // SP$ section (comes before AC$ in some records)
    if (record.SP$SCIENTIFIC_NAME) {
      lines.push(`SP$SCIENTIFIC_NAME: ${record.SP$SCIENTIFIC_NAME}`);
    }
    if (record.SP$LINEAGE) {
      lines.push(`SP$LINEAGE: ${record.SP$LINEAGE}`);
    }
    if (record.SP$LINK) {
      for (const link of record.SP$LINK) {
        lines.push(`SP$LINK: ${link}`);
      }
    }
    if (record.SP$SAMPLE) {
      lines.push(`SP$SAMPLE: ${record.SP$SAMPLE}`);
    }

    // AC$ section
    if (record.AC$INSTRUMENT) {
      lines.push(`AC$INSTRUMENT: ${record.AC$INSTRUMENT}`);
    }
    if (record.AC$INSTRUMENT_TYPE) {
      lines.push(`AC$INSTRUMENT_TYPE: ${record.AC$INSTRUMENT_TYPE}`);
    }
    if (record.AC$MASS_SPECTROMETRY) {
      for (const ms of record.AC$MASS_SPECTROMETRY) {
        lines.push(`AC$MASS_SPECTROMETRY: ${ms}`);
      }
    }
    if (record.AC$CHROMATOGRAPHY) {
      for (const chrom of record.AC$CHROMATOGRAPHY) {
        lines.push(`AC$CHROMATOGRAPHY: ${chrom}`);
      }
    }

    // MS$ section
    if (record.MS$FOCUSED_ION) {
      for (const ion of record.MS$FOCUSED_ION) {
        lines.push(`MS$FOCUSED_ION: ${ion}`);
      }
    }
    if (record.MS$DATA_PROCESSING) {
      for (const dp of record.MS$DATA_PROCESSING) {
        lines.push(`MS$DATA_PROCESSING: ${dp}`);
      }
    }

    // PK$ section - order: SPLASH, ANNOTATION, NUM_PEAK, PEAK
    if (record.PK$SPLASH) {
      lines.push(`PK$SPLASH: ${record.PK$SPLASH}`);
    }
    if (record.PK$ANNOTATION && record.PK$ANNOTATION.length > 0) {
      // Use original header if available, otherwise use default
      const header =
        record._PK$ANNOTATION_HEADER ||
        'm/z annotation exact_mass error(ppm)';
      lines.push(`PK$ANNOTATION: ${header}`);
      for (const ann of record.PK$ANNOTATION) {
        // Use original string if available for perfect round-trip
        if (ann._original) {
          lines.push(`  ${ann._original}`);
        } else {
          const parts: string[] = [ann.mz.toString()];
          if (ann.annotation) {
            parts.push(ann.annotation);
          }
          if (ann.exactMass !== undefined) {
            parts.push(ann.exactMass.toString());
          }
          if (ann.errorPpm !== undefined) {
            parts.push(ann.errorPpm.toString());
          }
          lines.push(`  ${parts.join(' ')}`);
        }
      }
    }
    if (record.PK$NUM_PEAK !== undefined) {
      lines.push(`PK$NUM_PEAK: ${record.PK$NUM_PEAK}`);
    }
    if (record.PK$PEAK && record.PK$PEAK.length > 0) {
      lines.push('PK$PEAK: m/z int. rel.int.');
      for (const peak of record.PK$PEAK) {
        // Use original strings if available for perfect round-trip
        if (peak._original) {
          lines.push(
            `  ${peak._original.mz} ${peak._original.intensity} ${peak._original.relativeIntensity}`,
          );
        } else {
          lines.push(
            `  ${peak.mz} ${peak.intensity} ${peak.relativeIntensity}`,
          );
        }
      }
    }

    // Terminator
    lines.push('//');

    // Join with newlines and add trailing newline to match original file format
    return `${lines.join('\n')  }\n`;
  }
}

/**
 * Factory function to create a serializer instance
 */
export function createSerializer(): IRecordSerializer {
  return new RecordSerializer();
}

/**
 * Convenience function to serialize a record
 * @param record
 */
export function serializeRecord(record: Record): string {
  const serializer = createSerializer();
  return serializer.serialize(record);
}
