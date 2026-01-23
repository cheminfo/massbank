import type { MeasurementXY, TextData } from 'cheminfo-types';
import { ensureString } from 'ensure-string';

import { parseRecord } from './parser/parse-record.ts';
import { postParsing } from './parser/post-parsing.ts';

export function getVariables(blob: TextData): MeasurementXY {
  const text = ensureString(blob);
  const parsed = parseRecord(text);

  const enhanced = postParsing(parsed);

  const { peakData, recordTitle, ...meta } = enhanced;

  // peakData could in fact also contain annotations that we are ignoring here

  const measurementXY: MeasurementXY = {
    variables: {
      x: {
        label: 'm/z',
        data: peakData?.peak?.map((p) => p.mz) ?? [],
      },
      y: {
        label: 'intensity',
        data: peakData?.peak?.map((p) => p.intensity) ?? [],
      },
    },
    dataType: 'Mass spectrum',
    title: recordTitle ?? '',
    meta,
  };
  return measurementXY;
}
