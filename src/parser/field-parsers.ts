import type { Record } from '../record.js';

import type { IFieldParser } from './interfaces.js';

/**
 * Base class for field parsers
 */
abstract class BaseFieldParser implements IFieldParser {
  abstract canParse(key: string): boolean;
  abstract parse(key: string, value: string, record: Record): void;
}

/**
 * Header field parser
 */
export class HeaderFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    const headerFields = [
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
    ];
    return headerFields.includes(key);
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'ACCESSION':
        record.ACCESSION = value;
        break;
      case 'RECORD_TITLE':
        record.RECORD_TITLE = value;
        break;
      case 'DATE':
        record.DATE = value;
        break;
      case 'AUTHORS':
        record.AUTHORS = value;
        break;
      case 'LICENSE':
        record.LICENSE = value;
        break;
      case 'COPYRIGHT':
        record.COPYRIGHT = value;
        break;
      case 'PUBLICATION':
        record.PUBLICATION = value;
        break;
      case 'PROJECT':
        record.PROJECT = value;
        break;
      case 'COMMENT':
        if (!record.COMMENT) {
          record.COMMENT = [];
        }
        record.COMMENT.push(value);
        break;
      case 'DEPRECATED':
        record.DEPRECATED = value;
        break;
    }
  }
}

/**
 * Compound (CH$) field parser
 */
export class CompoundFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    return key.startsWith('CH$');
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'CH$NAME':
        if (!record.CH$NAME) {
          record.CH$NAME = [];
        }
        record.CH$NAME.push(value);
        break;
      case 'CH$COMPOUND_CLASS':
        record.CH$COMPOUND_CLASS = value;
        break;
      case 'CH$FORMULA':
        record.CH$FORMULA = value;
        break;
      case 'CH$EXACT_MASS':
        record.CH$EXACT_MASS = value;
        break;
      case 'CH$SMILES':
        record.CH$SMILES = value;
        break;
      case 'CH$IUPAC':
        record.CH$IUPAC = value;
        break;
      case 'CH$LINK':
        if (!record.CH$LINK) {
          record.CH$LINK = [];
        }
        record.CH$LINK.push(value);
        break;
    }
  }
}

/**
 * Analytical conditions (AC$) field parser
 */
export class AnalyticalConditionsFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    return key.startsWith('AC$');
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'AC$INSTRUMENT':
        record.AC$INSTRUMENT = value;
        break;
      case 'AC$INSTRUMENT_TYPE':
        record.AC$INSTRUMENT_TYPE = value;
        break;
      case 'AC$MASS_SPECTROMETRY':
        if (!record.AC$MASS_SPECTROMETRY) {
          record.AC$MASS_SPECTROMETRY = [];
        }
        record.AC$MASS_SPECTROMETRY.push(value);
        break;
      case 'AC$CHROMATOGRAPHY':
        if (!record.AC$CHROMATOGRAPHY) {
          record.AC$CHROMATOGRAPHY = [];
        }
        record.AC$CHROMATOGRAPHY.push(value);
        break;
    }
  }
}

/**
 * Mass spectrometry (MS$) field parser
 */
export class MassSpectrometryFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    return key.startsWith('MS$');
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'MS$FOCUSED_ION':
        if (!record.MS$FOCUSED_ION) {
          record.MS$FOCUSED_ION = [];
        }
        record.MS$FOCUSED_ION.push(value);
        break;
      case 'MS$DATA_PROCESSING':
        if (!record.MS$DATA_PROCESSING) {
          record.MS$DATA_PROCESSING = [];
        }
        record.MS$DATA_PROCESSING.push(value);
        break;
    }
  }
}

/**
 * Peak (PK$) field parser (non-table fields)
 */
export class PeakFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    return (
      key.startsWith('PK$') && key !== 'PK$PEAK' && key !== 'PK$ANNOTATION'
    );
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'PK$SPLASH':
        record.PK$SPLASH = value;
        break;
      case 'PK$NUM_PEAK':
        const numPeak = Number.parseInt(value, 10);
        if (isNaN(numPeak)) {
          throw new Error(`Invalid PK$NUM_PEAK value: ${value}`);
        }
        record.PK$NUM_PEAK = numPeak;
        break;
    }
  }
}

/**
 * Species (SP$) field parser
 */
export class SpeciesFieldParser extends BaseFieldParser {
  canParse(key: string): boolean {
    return key.startsWith('SP$');
  }

  parse(key: string, value: string, record: Record): void {
    switch (key) {
      case 'SP$SCIENTIFIC_NAME':
        record.SP$SCIENTIFIC_NAME = value;
        break;
      case 'SP$LINEAGE':
        record.SP$LINEAGE = value;
        break;
      case 'SP$LINK':
        if (!record.SP$LINK) {
          record.SP$LINK = [];
        }
        record.SP$LINK.push(value);
        break;
      case 'SP$SAMPLE':
        record.SP$SAMPLE = value;
        break;
    }
  }
}
