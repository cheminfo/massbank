import camelcase from 'camelcase';

import type {
  AnnotationWithOriginal,
  InternalRecord,
  MassBankRecord,
  PeakWithOriginal,
} from '../record.ts';

/**
 * InternalRecord is a nearly flat struture, we will organize it
 * @param parsed
 */
const groupKeyMap = {
  CH: 'compound',
  AC: 'analyticalConditions',
  MS: 'massSpectrometryData',
  PK: 'peakData',
  SP: 'species',
} as const;

/**
 * InternalRecord is a nearly flat structure; convert it to a camel-cased Record.
 * @param parsed
 */
export function postParsing(parsed: InternalRecord): MassBankRecord {
  const result: MassBankRecord = { accession: parsed.ACCESSION };

  for (const [rawKey, value] of Object.entries(parsed)) {
    if (rawKey === 'ACCESSION' || rawKey.startsWith('_')) continue;

    if (rawKey.includes('$')) {
      const [mainKey, subKey] = rawKey.split('$') as [string, string];
      const groupKey = groupKeyMap[mainKey as keyof typeof groupKeyMap];
      if (!groupKey) continue;

      result[groupKey] ??= {};

      const camelSubKey = camelcase(subKey, { pascalCase: false });

      let normalizedValue = value;
      if (mainKey === 'PK' && subKey === 'PEAK' && Array.isArray(value)) {
        normalizedValue = stripPeakOriginal(value);
      } else if (
        mainKey === 'PK' &&
        subKey === 'ANNOTATION' &&
        Array.isArray(value)
      ) {
        normalizedValue = stripAnnotationOriginal(value);
      }

      (result[groupKey] as Record<string, unknown>)[camelSubKey] =
        normalizedValue;
      continue;
    }

    const camelKey = camelcase(rawKey, { pascalCase: false });
    //@ts-expect-error don't know how to fix this
    result[camelKey] = value;
  }

  return result;
}

function stripPeakOriginal(peaks: PeakWithOriginal[]) {
  return peaks.map(({ mz, intensity, relativeIntensity }) => ({
    mz,
    intensity,
    relativeIntensity,
  }));
}

function stripAnnotationOriginal(annotations: AnnotationWithOriginal[]) {
  return annotations.map(({ mz, annotation, exactMass, errorPpm }) => ({
    mz,
    annotation,
    exactMass,
    errorPpm,
  }));
}
