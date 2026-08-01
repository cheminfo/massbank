import { describe, expect, it } from 'vitest';

import * as massbank from '../../index.ts';

describe('public API surface', () => {
  it('exports the builder surface a consumer needs', () => {
    const missing = [
      'parseRecord',
      'ParseException',
      'serializeRecord',
      'buildRecord',
      'validateRecord',
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
