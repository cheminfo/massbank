/**
 * MassBank Record structure
 */

export interface Peak {
  mz: number;
  intensity: number;
  relativeIntensity: number;
  // Store original string representations for round-trip serialization
  _original?: {
    mz: string;
    intensity: string;
    relativeIntensity: string;
  };
}

export interface Annotation {
  mz: number;
  annotation?: string;
  exactMass?: number;
  errorPpm?: number;
  // Store original string representation for round-trip serialization
  _original?: string;
}

export interface Record {
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
  PK$PEAK?: Peak[];
  PK$ANNOTATION?: Annotation[];
  // Store original annotation header for exact serialization
  _PK$ANNOTATION_HEADER?: string;

  // SP$ section - Species information
  SP$SCIENTIFIC_NAME?: string;
  SP$LINEAGE?: string;
  SP$LINK?: string[];
  SP$SAMPLE?: string;
}
