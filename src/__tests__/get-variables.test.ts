import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { getVariables } from '../get-variables.ts';

test('getVariables works', async () => {
  const data = await readFile(
    join(import.meta.dirname, 'data/MSBNK-test-TST00001.txt'),
  );
  const variables = getVariables(data);

  expect(variables).toStrictEqual({
    variables: {
      x: { label: 'm/z', data: [185.1073, 213.1022, 258.1237] },
      y: { label: 'intensity', data: [73653728, 235010720, 52446636] },
    },
    dataType: 'Mass spectrum',
    title: 'Fiscalin C; LC-ESI-ITFT; MS2; CE: 30; R=17500; [M+H]+',
    meta: {
      accession: 'MSBNK-test-TST00001',
      date: '2017.07.07',
      authors:
        'Megan J. Kelman, Justin B. Renaud, Mark W. Sumarah, Agriculture and Agri-Food Canada',
      license: 'CC BY-SA',
      compound: {
        name: ['Fiscalin C'],
        compoundClass: 'Natural Product',
        formula: 'C27H29N5O4',
        exactMass: '487.22194',
        smiles:
          'CC(C)[C@H]1C2=NC3=CC=CC=C3C(=O)N2[C@@H](C(=O)N1)C[C@@]4([C@@H]5NC(C(=O)N5C6=CC=CC=C64)(C)C)O',
        iupac:
          'InChI=1S/C27H29N5O4/c1-14(2)20-21-28-17-11-7-5-9-15(17)23(34)31(21)19(22(33)29-20)13-27(36)16-10-6-8-12-18(16)32-24(27)30-26(3,4)25(32)35/h5-12,14,19-20,24,30,36H,13H2,1-4H3,(H,29,33)/t19-,20+,24-,27-/m1/s1',
      },
      analyticalConditions: {
        instrument: 'Q-Exactive Orbitrap Thermo Scientific',
        instrumentType: 'LC-ESI-ITFT',
        massSpectrometry: ['MS_TYPE MS2', 'ION_MODE POSITIVE'],
      },
    },
  });
});
