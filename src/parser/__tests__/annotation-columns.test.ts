import { describe, expect, it } from 'vitest';

import {
  mapAnnotationHeader,
  normaliseHeaderToken,
} from '../annotation-columns.js';

describe('normaliseHeaderToken', () => {
  it('lowercases and strips punctuation so one entry covers the variants', () => {
    expect(normaliseHeaderToken('error(ppm)')).toBe('errorppm');
    expect(normaliseHeaderToken('error_ppm')).toBe('errorppm');
    expect(normaliseHeaderToken('ERROR(PPM)')).toBe('errorppm');
    expect(normaliseHeaderToken('m/z')).toBe('mz');
    expect(normaliseHeaderToken('tentative_formula')).toBe('tentativeformula');
  });
});

describe('mapAnnotationHeader', () => {
  it('maps the header used by every annotated record in the corpus', () => {
    expect(
      mapAnnotationHeader(
        'm/z tentative_formula formula_count mass error(ppm)',
      ),
    ).toStrictEqual([
      { token: 'm/z', field: 'mz' },
      { token: 'tentative_formula', field: 'annotation' },
      { token: 'formula_count', field: null },
      { token: 'mass', field: 'exactMass' },
      { token: 'error(ppm)', field: 'errorPpm' },
    ]);
  });

  it("maps this repo's and the Java reference's fixture header", () => {
    expect(
      mapAnnotationHeader('m/z annotation exact_mass error(ppm)'),
    ).toStrictEqual([
      { token: 'm/z', field: 'mz' },
      { token: 'annotation', field: 'annotation' },
      { token: 'exact_mass', field: 'exactMass' },
      { token: 'error(ppm)', field: 'errorPpm' },
    ]);
  });

  it('maps the two short fixture headers', () => {
    expect(mapAnnotationHeader('m/z ion')).toStrictEqual([
      { token: 'm/z', field: 'mz' },
      { token: 'ion', field: 'annotation' },
    ]);
    expect(mapAnnotationHeader('m/z')).toStrictEqual([
      { token: 'm/z', field: 'mz' },
    ]);
  });

  it('routes an unrecognised token to extra rather than guessing a field', () => {
    const columns = mapAnnotationHeader('m/z something_novel');

    expect(columns).toStrictEqual([
      { token: 'm/z', field: 'mz' },
      { token: 'something_novel', field: null },
    ]);
  });

  it('does NOT relabel a millidalton error as ppm', () => {
    // `error` alone means ppm by convention, but a unit-carrying token must not
    // inherit that meaning — it goes to extra, where nothing is claimed about it.
    const columns = mapAnnotationHeader('m/z error(mDa)');

    expect(columns?.[1]).toStrictEqual({ token: 'error(mDa)', field: null });
  });

  it('tolerates leading, trailing and repeated whitespace', () => {
    expect(mapAnnotationHeader('  m/z   ion  ')).toStrictEqual([
      { token: 'm/z', field: 'mz' },
      { token: 'ion', field: 'annotation' },
    ]);
  });

  it('refuses a header whose first column is not the m/z', () => {
    expect(mapAnnotationHeader('annotation m/z')).toBeNull();
    expect(mapAnnotationHeader('intensity m/z')).toBeNull();
  });

  it('refuses an empty header', () => {
    expect(mapAnnotationHeader('')).toBeNull();
    expect(mapAnnotationHeader('   ')).toBeNull();
  });

  it('refuses a header that maps two columns onto one field', () => {
    // `mass` and `exact_mass` both mean exactMass; the second would silently
    // overwrite the first.
    expect(mapAnnotationHeader('m/z mass exact_mass')).toBeNull();
  });

  it('refuses a header with a duplicated token', () => {
    expect(mapAnnotationHeader('m/z formula_count formula_count')).toBeNull();
  });
});
