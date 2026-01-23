/**
 * MassBank InternalRecord structure
 */

export interface Peak {
  mz: number;
  intensity: number;
  relativeIntensity: number;
}

export interface Annotation {
  mz: number;
  annotation?: string;
  exactMass?: number;
  errorPpm?: number;
}

export interface PeakWithOriginal extends Peak {
  // Store original string representations for round-trip serialization
  _original?: {
    mz: string;
    intensity: string;
    relativeIntensity: string;
  };
}

export interface AnnotationWithOriginal extends Annotation {
  // Store original string representation for round-trip serialization
  _original?: string;
}

export interface InternalRecord {
  // Header fields
  ACCESSION: string;
  RECORD_TITLE?: string;
  DATE?: string;
  AUTHORS?: string;
  LICENSE?: string;
  COPYRIGHT?: string;
  PUBLICATION?: string;
  PROJECT?: string;
  COMMENT?: string[];
  DEPRECATED?: string;

  // CH$ section - Compound information
  CH$NAME?: string[];
  CH$COMPOUND_CLASS?: string;
  CH$FORMULA?: string;
  CH$EXACT_MASS?: string;
  CH$SMILES?: string;
  CH$IUPAC?: string;
  CH$LINK?: string[];

  // AC$ section - Analytical conditions
  AC$INSTRUMENT?: string;
  AC$INSTRUMENT_TYPE?: string;
  AC$MASS_SPECTROMETRY?: string[];
  AC$CHROMATOGRAPHY?: string[];

  // MS$ section - Mass spectrometry data
  MS$FOCUSED_ION?: string[];
  MS$DATA_PROCESSING?: string[];

  // PK$ section - Peak data
  PK$SPLASH?: string;
  PK$NUM_PEAK?: number;
  PK$PEAK?: PeakWithOriginal[];
  PK$ANNOTATION?: AnnotationWithOriginal[];
  // Store original annotation header for exact serialization
  _PK$ANNOTATION_HEADER?: string;

  // SP$ section - Species information
  SP$SCIENTIFIC_NAME?: string;
  SP$LINEAGE?: string;
  SP$LINK?: string[];
  SP$SAMPLE?: string;
}

export interface MassBankRecord {
  accession: string;
  recordTitle?: string;
  date?: string;
  authors?: string;
  license?: string;
  copyright?: string;
  publication?: string;
  project?: string;
  comment?: string[];
  deprecated?: string;

  compound?: {
    name?: string[];
    compoundClass?: string;
    formula?: string;
    exactMass?: string;
    smiles?: string;
    iupac?: string;
    link?: string[];
  };

  analyticalConditions?: {
    instrument?: string;
    instrumentType?: string;
    massSpectrometry?: string[];
    chromatography?: string[];
  };

  massSpectrometryData?: {
    focusedIon?: string[];
    dataProcessing?: string[];
  };

  peakData?: {
    splash?: string;
    numPeak?: number;
    peak?: Peak[];
    annotation?: Annotation[];
  };

  species?: {
    scientificName?: string;
    lineage?: string;
    link?: string[];
    sample?: string;
  };
}
