import { describe, expect, it } from 'vitest';

import { buildRecord as deepBuildRecord } from '../../builder/build-record.ts';
import { BuildException as deepBuildException } from '../../builder/exceptions.ts';
import { validateRecord as deepValidateRecord } from '../../builder/validate-record.ts';
import * as massbank from '../../index.ts';

describe('public API surface', () => {
  it('exports the builder surface a consumer needs', () => {
    const missing = [
      'parseRecord',
      'ParseException',
      'serializeRecord',
      'buildRecord',
      'validateRecord',
      'BuildException',
    ].filter((name) => massbank[name as keyof typeof massbank] === undefined);

    expect(missing).toStrictEqual([]);
  });

  it('keeps the pre-existing surface intact', () => {
    const missing = [
      'validate',
      'validateContent',
      'getVariables',
      'calculateSplash',
      'resolveSplash',
      'resolveSplashFromRecord',
      'fillSplash',
      'SplashValidator',
      'createSplashValidator',
    ].filter((name) => massbank[name as keyof typeof massbank] === undefined);

    expect(missing).toStrictEqual([]);
  });
});

describe('the exported builder functions are the real implementations', () => {
  // The surface test above only checks that a name resolves to something
  // defined — a barrel that re-exports the wrong function under the right
  // name would still pass it. These calls exercise real behaviour through
  // the package root import, not a deep import, so a mis-bound export in
  // src/builder/index.ts or src/index.ts is actually caught.

  it('buildRecord imported from the package root normalises a draft', async () => {
    const record = await massbank.buildRecord({
      ACCESSION: 'MSBNK-test-TST00001',
      PK$PEAK: [{ mz: 100.25, intensity: 100, relativeIntensity: 999 }],
      PK$ANNOTATION: [{ mz: 100.25, annotation: 'fragment' }],
    });

    expect(record.PK$NUM_PEAK).toBe(1);
    expect(record.PK$SPLASH).toMatch(/^splash10-/);
    // A wrapper that drops PK$ANNOTATION (e.g. forwarding only some of its
    // arguments) would still pass the two assertions above without this one —
    // the draft must carry annotations for this path to be exercised at all.
    expect(record.PK$ANNOTATION).toStrictEqual([
      { mz: 100.25, annotation: 'fragment' },
    ]);
  });

  it('validateRecord imported from the package root validates a real record', async () => {
    const record = await massbank.buildRecord({
      ACCESSION: 'MSBNK-test-TST00001',
      PK$PEAK: [{ mz: 100.25, intensity: 100, relativeIntensity: 999 }],
    });

    const result = await massbank.validateRecord(record);

    expect(result.success).toBe(true);
    expect(result.accessions).toContain('MSBNK-test-TST00001');
  });

  it('buildRecord and validateRecord imported from the package root are the exact same function as the deep import', () => {
    // No rule reads ValidationOptions.legacy, so there is no behavioural way
    // to prove a wrapper forwards `options` — a wrapper that silently drops
    // it would still validate correctly on every case this suite can
    // construct. Reference identity catches any such wrapper regardless of
    // what it drops, because a wrapper is necessarily a different function
    // object than the one it wraps.
    expect(massbank.buildRecord).toBe(deepBuildRecord);
    expect(massbank.validateRecord).toBe(deepValidateRecord);
  });

  it('BuildException imported from the package root is the exact same class as the deep import', () => {
    expect(massbank.BuildException).toBe(deepBuildException);
  });

  it('buildRecord imported from the package root throws the real BuildException with every failure aggregated', async () => {
    let caught: unknown;
    try {
      await massbank.buildRecord({
        ACCESSION: '',
        PK$PEAK: [{ mz: -1, intensity: 10, relativeIntensity: -5 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(massbank.BuildException);

    const codes = (
      caught as InstanceType<typeof massbank.BuildException>
    ).buildErrors.map((buildError) => buildError.code);

    expect(codes).toStrictEqual([
      'ACCESSION_EMPTY',
      'PEAK_RELATIVE_INTENSITY_NEGATIVE',
      'PEAK_MZ_NEGATIVE',
    ]);
  });
});
