# Builder API (Release B / B2) — Implementation Plan (rev. 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a consumer build a MassBank record from structured data and get back text that round-trips and passes this library's rule set — so the NoBS editor can delete its hand-rolled serializer.

**Architecture:** Two new modules under `src/builder/`, plus a minimal export surface. `buildRecord` normalises a draft into a canonical `InternalRecord`; `validateRecord` serialises and delegates to the existing `validateContent`. No parser change, no serializer change, no new validation rules.

**Tech Stack:** TypeScript ESM, vitest, strict + `noUncheckedIndexedAccess`. No new dependencies.

**Branch:** `feat/builder-api`, off `543ee91` (the v0.4.1 release).

---

## What changed in rev. 2

Three independent reviews implemented rev. 1 end to end. The core worked — 126 tests, tsc clean, tarball installs and runs `buildRecord → validateRecord → success` — but the packaging around it did not, and the plan claimed more than it delivered.

| Was                                                                                                                        | Now                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exported `RecordValidator`, `IValidationRule`, `PeakWithOriginal`, `AnnotationWithOriginal`, `UNMAPPABLE_INSTRUMENT_HINTS` | **Dropped.** `validateContent` hardcodes `new RecordValidator()` — there is no injection point — and `IValidationRule` cannot even be implemented because `ValidationRuleOptions` isn't exported. An extension interface with no extension point is decorative. |
| Goal: "text the **Java** validator accepts"                                                                                | **Restated.** B2 has no mandatory-field rule (B3) and no CV validation (B4), so it cannot deliver that bar.                                                                                                                                                     |
| `buildRecord` accepts `Partial<InternalRecord>`                                                                            | **`RecordDraft`** — `_original` and `_PK$ANNOTATION_HEADER` excluded and stripped at runtime. Rev. 1 corrupted records (below).                                                                                                                                 |
| Task 4 pinned "preserves duplicate m/z" with no decision behind it                                                         | **Decision recorded** (D1). Duplicates are legal; B5's peak-sort rule must be non-strict.                                                                                                                                                                       |
| Four motivating defects                                                                                                    | **Six**, including a live NoBS bug rev. 1 didn't know about.                                                                                                                                                                                                    |

**The corruption rev. 1 shipped.** `Partial<InternalRecord>` accepts `PeakWithOriginal[]`. `buildRecord` sorted those objects but never stripped `_original`, and `serializeRecord` _prefers_ `_original` while `PK$SPLASH`/`PK$NUM_PEAK` derive from the numeric fields. Measured: parse → edit `peak[0].mz` → build → serialize emits a SPLASH computed from the new value over peak rows printed from the old one, and `validateRecord` returns **false** blaming the SPLASH. `buildRecord` produced a record failing its own validator.

## Why this task exists, measured

`serializeRecord` already handles a from-scratch record and its output is a fixed point of `serialize ∘ parse` on the first pass. So serialization is free. The value is in what the validator **cannot see** — all six of these return `success: true` from `validateContent`:

| Input                                           | Verdict  |
| ----------------------------------------------- | -------- |
| peaks ordered `300.5, 100.25, 200`              | ACCEPTED |
| `PK$NUM_PEAK: 99` with three actual peaks       | ACCEPTED |
| duplicate m/z                                   | ACCEPTED |
| no `PK$SPLASH` at all                           | ACCEPTED |
| `PK$NUM_PEAK: 99` with **no peak table at all** | ACCEPTED |
| a record containing only `ACCESSION`            | ACCEPTED |

`SerializationRule` tests that text is a fixed point of `serialize ∘ parse` — _self-consistency_, which is orthogonal to correctness. `PK$NUM_PEAK: 99` is perfectly self-consistent; it just isn't true.

**And B2 fixes a live NoBS defect.** `buildMassBankText.ts` emits `COMMENT` after `MS$FOCUSED_ION`; the package serializer puts it in the header block. So whenever preserved MGF params exist the output is not a fixed point:

```
[serialization] File formatting issue detected (round-trip validation failed).
Expected (16 chars): "COMMENT: SCANS 1" but found (17 chars): "CH$NAME: Caffeine"
```

`massBankValidationService.ts:61` filters only `type !== 'splash'`, so that error is **blocking** → `isValid: false`. Preserved params mean SCANS/INCHIKEY — effectively every GNPS-derived MGF. The B2 path on identical input is a fixed point and validates green. This is the on-priority justification: the 2026-07-29 project meeting named _"avoid losing meta information"_ as the most critical requirement.

**What `buildRecord` does NOT guarantee.** It makes the peak table internally consistent. It does not check mandatory fields (B3) or vocabularies (B4). A record with only `ACCESSION` still validates green. Do not describe it as the only thing between a UI and an invalid record — that claim was measured false.

## Decisions

| #      | Decision                                                                                               | Rationale                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **Duplicate m/z are legal.** `buildRecord` preserves them; **B5's peak-sort rule must be non-strict.** | Dropping loses data, summing invents it, and no source consulted forbids duplicates. Recorded here because the 0.5.0 charter says "strictly ascending" in two places — B5 must be corrected, or it will invalidate B2's own output the day it lands.                                     |
| **D2** | `buildRecord` stays **async**                                                                          | `calculateSplash` uses `crypto.subtle.digest`, and Web Crypto has **no synchronous digest in browsers** — the package's primary target. No factoring can compute SPLASH synchronously. Do not "fix" this by splitting; splitting means the default path emits an absent or stale SPLASH. |
| **D3** | `validateRecord` derives the filename from `ACCESSION`                                                 | An `InternalRecord` has no filename. This makes `AccessionMatchRule` structurally unable to fail on that path — documented and pinned by a differential test, not merely asserted.                                                                                                       |
| **D4** | **No validity-profile knob**                                                                           | `ValidationOptions.legacy` is already threaded to every rule and read by none (verified). A `profile` knob would be identical until B5 gives it something to gate — and worse than absent, since a consumer passing `'submission'` would silently get lenient behaviour.                 |
| **D5** | `buildRecord` **propagates** `calculateSplash`'s `RangeError`                                          | An all-zero or non-finite spectrum is not publishable. Note the asymmetry this creates — `SplashRule` deliberately _swallows_ the same error ("skip rather than crash") — so it must be documented with `@throws` and given a test, and Phase C needs an error path.                     |

## Global Constraints

- **No new validation rules.** Peak-order, num-peak and duplicate detection are B5.
- **Do not modify the parser or serializer.** If a normalisation appears to need one, STOP and escalate.
- **`serializeRecord ∘ buildRecord` must be a fixed point** under `parseRecord`. Binding correctness property.
- **Lint is part of `npm test` and rev. 1 failed it at every step.** Before writing code, know these: use **dot notation** (`record.PK$PEAK`, never `record['PK$PEAK']`) — `dot-notation` flagged 18; use **`toSorted`**, never `[...x].sort()` — `unicorn/no-array-sort`; **`expect(value, label)` is banned** — `vitest/valid-expect` allows one argument; use **`toStrictEqual`**, never `toEqual`; do not write `(await f()).x` — hoist it; type imports come after value imports in the same group.
- Commit messages: subject-only conventional, no body, **no `Co-Authored-By`**. `feat:` — this is the reserved 0.5.0 minor.
- TypeScript strict; no `any`; **no `as` casts to silence the compiler** (see Task 2 Step 3).

## Release note for the 0.5.0 changelog

State which B-items ship in 0.5.0. Phase C's entry gate reads _"0.5.0 published **and** the NoBS advisory tier (B0)"_ — but B0 exists only to protect NoBS's issue count from **B1's** warnings. **If 0.5.0 ships B2-only, B0 is not required and Phase C unblocks.** If B1 rides along, it is. Say so, or Phase C's executor reads the gate literally and stays blocked.

Also record the forward commitment, which costs nothing now and buys B5 freedom later:

> `validateRecord` is the strict/submission entry point from 0.5.0: new semantic checks will be added to it in minor releases. `validate` and `validateContent` keep their current rule set.

## Facts established — do not re-derive

- `parseRecord`, `serializeRecord`, `InternalRecord` exist at `src/parser/parse-record.ts`, `src/serializer/record-serializer.ts`, `src/record.ts`.
- `package.json` has `exports: {".": "./lib/index.js"}` and **no** `sideEffects` field. `sideEffects: false` is **safe** — the module graph was scanned; no top-level executable statements.
- `validateContent(content, filename, options = {})` — filename required, feeds `AccessionMatchRule`, whose message begins `"ACCESSION mismatch: File is named …"` and **never contains the substring `filename`**.
- `calculateSplash` is async, throws `RangeError` on empty / all-zero / non-finite input, and is **order-insensitive** — sorting before hashing is safe.
- All `InternalRecord` fields except `ACCESSION` are optional, so `delete` needs no cast and `const record: InternalRecord = { ...draft }` compiles without one.
- `CH$EXACT_MASS` is `string`, not `number`.
- The tarball's `exports` change is safe: `massbank/lib/index.js` was already blocked by the pre-existing shorthand, so it is not a regression.

## Baseline

```bash
npx prettier --write docs/        # rev. 1's own plan docs fail the prettier gate
npm test                          # then expect green: 109 passed / 1 skipped
```

---

### Task 1: Export the builder surface

**Why:** consumers cannot reach `parseRecord`, `serializeRecord` or `InternalRecord` today — the `exports` map has one entry and `src/index.ts` re-exports only the validator/splash surface. NoBS hand-rolled a serializer because of it.

**Files:** Modify `src/index.ts`, `package.json` · Test `src/__tests__/builder/exports.test.ts` (new)

**Interfaces:** value exports `parseRecord`, `serializeRecord`, `buildRecord`, `validateRecord`; type exports `InternalRecord`, `Peak`, `Annotation`, `RecordDraft`.

- [ ] **Step 1: Write the failing test**

`buildRecord` and `validateRecord` **must be in this list**. In rev. 1 they were not, and deleting the builder barrel from `src/index.ts` left the whole suite green — the deliverable itself was unguarded because every other test imported the deep relative path.

```ts
import { describe, expect, it } from 'vitest';
import * as massbank from '../../index.ts';

describe('public API surface', () => {
  it('exports the builder surface a consumer needs', () => {
    const missing = [
      'parseRecord',
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
```

`filter`-then-`toStrictEqual` rather than a loop with labelled `expect` — `vitest/valid-expect` bans the second argument, and this reports _which_ export is missing rather than just that one is.

- [ ] **Step 2: Run it — the first test fails**

`npx vitest run src/__tests__/builder/exports.test.ts` → FAIL, `missing` contains all four.

- [ ] **Step 3: Implement**

In `src/index.ts`:

```ts
// Builder surface. Exported so consumers can construct records rather than
// hand-rolling the format — see docs/plans/2026-07-29-builder-api.md.
export { parseRecord } from './parser/parse-record.ts';
export { serializeRecord } from './serializer/record-serializer.ts';
export * from './builder/index.ts';

export type { Annotation, InternalRecord, Peak } from './record.ts';
```

`PeakWithOriginal` and `AnnotationWithOriginal` are deliberately **not** exported: they carry round-trip-fidelity internals no consumer should construct, and `InternalRecord` reaches them structurally anyway.

In `package.json` add `"sideEffects": false` and:

```json
  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json"
  },
```

- [ ] **Step 4: Verify** — `npm test`. Lint must be clean, not just vitest.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts package.json src/__tests__/builder/exports.test.ts
git commit -m "feat: export the record builder and parser primitives"
```

---

### Task 2: buildRecord

**Files:** Create `src/builder/build-record.ts`, `src/builder/index.ts` · Test `src/__tests__/builder/build-record.test.ts`

**Interfaces:**

```ts
export type RecordDraft = Partial<
  Omit<InternalRecord, 'PK$PEAK' | 'PK$ANNOTATION' | '_PK$ANNOTATION_HEADER'>
> & { ACCESSION: string; PK$PEAK?: Peak[]; PK$ANNOTATION?: Annotation[] };

export async function buildRecord(draft: RecordDraft): Promise<InternalRecord>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildRecord } from '../../builder/build-record.ts';
import { parseRecord } from '../../parser/parse-record.ts';
import { serializeRecord } from '../../serializer/record-serializer.ts';

const minimal = () => ({
  ACCESSION: 'MSBNK-test-TST00001',
  RECORD_TITLE: 'Caffeine; LC-ESI-QFT; MS2',
  DATE: '2026.07.29',
  AUTHORS: 'Doe J',
  LICENSE: 'CC BY',
  CH$NAME: ['Caffeine'],
  CH$FORMULA: 'C8H10N4O2',
  CH$EXACT_MASS: '194.0804',
  CH$SMILES: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
  CH$IUPAC: 'InChI=1S/C8H10N4O2',
  AC$INSTRUMENT: 'Thermo Q Exactive',
  AC$INSTRUMENT_TYPE: 'LC-ESI-QFT',
  AC$MASS_SPECTROMETRY: ['MS_TYPE MS2', 'ION_MODE POSITIVE'],
});

const unsorted = () => [
  { mz: 300.5, intensity: 10, relativeIntensity: 100 },
  { mz: 100.25, intensity: 100, relativeIntensity: 999 },
  { mz: 200, intensity: 50, relativeIntensity: 500 },
];

describe('buildRecord normalises what validation cannot detect', () => {
  it('sorts peaks ascending by m/z', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });
    expect(record.PK$PEAK?.map((p) => p.mz)).toStrictEqual([
      100.25, 200, 300.5,
    ]);
  });

  it('keeps each m/z paired with its own intensity when sorting', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });
    expect(record.PK$PEAK?.map((p) => [p.mz, p.intensity])).toStrictEqual([
      [100.25, 100],
      [200, 50],
      [300.5, 10],
    ]);
  });

  it('derives PK$NUM_PEAK, overriding a wrong one', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$NUM_PEAK: 99,
      PK$PEAK: unsorted(),
    });
    expect(record.PK$NUM_PEAK).toBe(3);
  });

  it('recomputes PK$SPLASH over a declared one', async () => {
    const stale = 'splash10-0000-0000000000-0000000000000000000000000000';
    const record = await buildRecord({
      ...minimal(),
      PK$SPLASH: stale,
      PK$PEAK: unsorted(),
    });
    expect(record.PK$SPLASH).toMatch(/^splash10-/);
    expect(record.PK$SPLASH).not.toBe(stale);
  });

  it('drops PK$NUM_PEAK when there are no peaks', async () => {
    // Otherwise a count survives with no table — a defect validateContent accepts.
    const record = await buildRecord({ ...minimal(), PK$NUM_PEAK: 99 });
    expect(record.PK$NUM_PEAK).toBeUndefined();
    expect(record.PK$PEAK).toBeUndefined();
  });

  it('drops an empty annotation table', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [],
      PK$PEAK: unsorted(),
    });
    expect(record.PK$ANNOTATION).toBeUndefined();
  });

  it('sorts annotations ascending', async () => {
    const record = await buildRecord({
      ...minimal(),
      PK$ANNOTATION: [{ mz: 200 }, { mz: 100.25 }],
      PK$PEAK: unsorted(),
    });
    expect(record.PK$ANNOTATION?.map((a) => a.mz)).toStrictEqual([100.25, 200]);
  });

  it('does not mutate its input', async () => {
    const peaks = unsorted();
    const draft = { ...minimal(), PK$PEAK: peaks, PK$NUM_PEAK: 99 };
    await buildRecord(draft);
    expect(peaks.map((p) => p.mz)).toStrictEqual([300.5, 100.25, 200]);
    expect(draft.PK$NUM_PEAK).toBe(99);
  });

  it('strips _original so the serializer cannot print stale text', async () => {
    // The corruption rev. 1 shipped: serializeRecord PREFERS _original, while
    // PK$SPLASH and PK$NUM_PEAK derive from the numeric fields. A record parsed,
    // edited and rebuilt then emitted a SPLASH that did not match its own rows.
    const parsed = parseRecord(
      serializeRecord(await buildRecord({ ...minimal(), PK$PEAK: unsorted() })),
    );
    const edited =
      parsed.PK$PEAK?.map((p) => ({ ...p, mz: p.mz + 0.001 })) ?? [];
    const rebuilt = await buildRecord({ ...minimal(), PK$PEAK: edited });
    expect(rebuilt.PK$PEAK?.every((p) => !('_original' in p))).toBe(true);
    expect(serializeRecord(rebuilt)).toContain('100.251');
  });

  it('preserves duplicate m/z', async () => {
    // D1: duplicates are legal — dropping loses data, summing invents it.
    const record = await buildRecord({
      ...minimal(),
      PK$PEAK: [
        { mz: 100.25, intensity: 100, relativeIntensity: 999 },
        { mz: 100.25, intensity: 50, relativeIntensity: 500 },
      ],
    });
    expect(record.PK$PEAK).toHaveLength(2);
    expect(record.PK$NUM_PEAK).toBe(2);
  });

  it('throws on a spectrum that cannot be hashed', async () => {
    // D5: propagated deliberately. SplashRule swallows the same error; the
    // builder does not, because an all-zero spectrum is not publishable.
    await expect(
      buildRecord({
        ...minimal(),
        PK$PEAK: [{ mz: 100.25, intensity: 0, relativeIntensity: 0 }],
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('the binding correctness property', () => {
  it('produces text that is a fixed point of serialize∘parse', async () => {
    const record = await buildRecord({ ...minimal(), PK$PEAK: unsorted() });
    const once = serializeRecord(record);
    expect(serializeRecord(parseRecord(once))).toBe(once);
  });

  it('is a fixed point with COMMENT present', async () => {
    // The live NoBS defect: preserved MGF params land in COMMENT, and the
    // hand-rolled serializer emitted it in the wrong block. Rev. 1's fixture had
    // no COMMENT and would not have caught a regression here.
    const record = await buildRecord({
      ...minimal(),
      COMMENT: ['SCANS 1', 'INCHIKEY RYYVLZVUVIJVGH-UHFFFAOYSA-N'],
      PK$PEAK: unsorted(),
    });
    const once = serializeRecord(record);
    expect(serializeRecord(parseRecord(once))).toBe(once);
  });
});
```

- [ ] **Step 2: Run it — the suite fails to collect** (module not found), so zero tests run rather than all failing.

- [ ] **Step 3: Implement**

```ts
import type { Annotation, InternalRecord, Peak } from '../record.ts';
import { calculateSplash } from '../splash/calculate-splash.ts';

// A record under construction. _original and _PK$ANNOTATION_HEADER are excluded:
// they carry round-trip fidelity for text that was parsed, and the serializer
// PREFERS them over the numeric fields — so a draft carrying them would print
// stale rows under a freshly computed SPLASH.
export type RecordDraft = Partial<
  Omit<InternalRecord, 'PK$PEAK' | 'PK$ANNOTATION' | '_PK$ANNOTATION_HEADER'>
> & {
  ACCESSION: string;
  PK$PEAK?: Peak[];
  PK$ANNOTATION?: Annotation[];
};

/**
 * Normalise a draft into a canonical record.
 *
 * This exists because validation cannot detect what it prevents: a record with
 * unsorted peaks, a wrong PK$NUM_PEAK or a stale PK$SPLASH round-trips cleanly
 * and validates green. SerializationRule tests self-consistency, which is
 * orthogonal to correctness.
 *
 * Duplicate m/z are preserved deliberately — a duplicate may be a real
 * instrument artifact, and dropping loses data while summing invents it.
 *
 * Never mutates its input. Output is NOT text-identical to a parsed source:
 * `100.2500` canonicalises to `100.25`. Round-trip fidelity is parse/serialize's
 * job; this function's contract is canonical output.
 *
 * @throws {RangeError} when the peak list cannot be hashed — empty, all-zero, or
 * non-finite. Note SplashRule swallows the same error; the builder does not,
 * because such a spectrum is not publishable.
 */
export async function buildRecord(draft: RecordDraft): Promise<InternalRecord> {
  const record: InternalRecord = { ...draft };

  const peaks = draft.PK$PEAK;
  if (peaks !== undefined && peaks.length > 0) {
    // Rebuild each peak from its numeric fields, discarding any _original a
    // caller smuggled through a structural type.
    const sorted = peaks
      .map((p) => ({
        mz: p.mz,
        intensity: p.intensity,
        relativeIntensity: p.relativeIntensity,
      }))
      .toSorted((a, b) => a.mz - b.mz);
    record.PK$PEAK = sorted;
    record.PK$NUM_PEAK = sorted.length;
    // Recompute rather than trust: a wrong SPLASH breaks cross-database matching
    // silently, which is worse than an absent one. calculateSplash is
    // order-insensitive, so sorting first is safe.
    record.PK$SPLASH = await calculateSplash(
      sorted.map((p) => ({ mz: p.mz, intensity: p.intensity })),
    );
  } else {
    delete record.PK$PEAK;
    delete record.PK$NUM_PEAK;
  }

  const annotations = draft.PK$ANNOTATION;
  if (annotations !== undefined && annotations.length > 0) {
    record.PK$ANNOTATION = annotations
      .map((a) => ({
        mz: a.mz,
        ...(a.annotation === undefined ? {} : { annotation: a.annotation }),
        ...(a.exactMass === undefined ? {} : { exactMass: a.exactMass }),
        ...(a.errorPpm === undefined ? {} : { errorPpm: a.errorPpm }),
      }))
      .toSorted((a, b) => a.mz - b.mz);
  } else {
    // An empty table serializes as a header with no rows.
    delete record.PK$ANNOTATION;
  }

  return record;
}
```

No `as InternalRecord` cast — `const record: InternalRecord = { ...draft }` compiles because every non-`ACCESSION` field is optional. The cast would be an escape hatch that silently swallows a future required field instead of forcing a decision.

Create `src/builder/index.ts` re-exporting `buildRecord` and `RecordDraft`; match the specifier style of `src/splash/index.ts`.

- [ ] **Step 4: Verify** — `npm test`, lint included.

- [ ] **Step 5: Commit**

```bash
git add src/builder/ src/__tests__/builder/build-record.test.ts
git commit -m "feat: add buildRecord to canonicalise a record draft"
```

---

### Task 3: validateRecord

**Files:** Create `src/builder/validate-record.ts` · Modify `src/builder/index.ts` · Test `src/__tests__/builder/validate-record.test.ts`

**Interfaces:** `validateRecord(record: InternalRecord, options?: ValidationOptions): Promise<ValidationResult>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildRecord } from '../../builder/build-record.ts';
import { validateRecord } from '../../builder/validate-record.ts';
import { serializeRecord } from '../../serializer/record-serializer.ts';
import { validateContent } from '../../validator/validateContent.ts';

const built = () =>
  buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    RECORD_TITLE: 'Caffeine; LC-ESI-QFT; MS2',
    DATE: '2026.07.29',
    AUTHORS: 'Doe J',
    LICENSE: 'CC BY',
    CH$NAME: ['Caffeine'],
    CH$FORMULA: 'C8H10N4O2',
    CH$EXACT_MASS: '194.0804',
    CH$SMILES: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
    CH$IUPAC: 'InChI=1S/C8H10N4O2',
    AC$INSTRUMENT: 'Thermo Q Exactive',
    AC$INSTRUMENT_TYPE: 'LC-ESI-QFT',
    AC$MASS_SPECTROMETRY: ['MS_TYPE MS2', 'ION_MODE POSITIVE'],
    PK$PEAK: [
      { mz: 300.5, intensity: 10, relativeIntensity: 100 },
      { mz: 100.25, intensity: 100, relativeIntensity: 999 },
    ],
  });

describe('validateRecord', () => {
  it('accepts a record produced by buildRecord', async () => {
    const result = await validateRecord(await built());
    expect(result.errors).toStrictEqual([]);
    expect(result.success).toBe(true);
  });

  it('reports the accession it validated', async () => {
    const result = await validateRecord(await built());
    expect(result.accessions).toContain('MSBNK-test-TST00001');
  });

  it('detects a defect genuinely in the text', async () => {
    // Proves the delegation is real and not a stub returning success.
    const record = await built();
    record.PK$SPLASH = 'splash10-0000-0000000000-0000000000000000000000000000';
    const result = await validateRecord(record);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.type === 'splash')).toBe(true);
  });

  it('passes options through to the rules', async () => {
    // Dropping the pass-through left rev. 1's suite green.
    const record = await built();
    const result = await validateRecord(record, { legacy: true });
    expect(result.success).toBe(true);
  });

  it('cannot fail the accession check, and the rule is alive elsewhere', async () => {
    // Differential. Rev. 1 asserted message.includes('filename'), but the real
    // message reads "ACCESSION mismatch: File is named …" — so it passed whether
    // or not the rule fired.
    const record = await built();
    record.ACCESSION = 'MSBNK-other-XYZ99999';
    expect((await validateRecord(record)).errors).toStrictEqual([]);

    const viaText = await validateContent(
      serializeRecord(record),
      'MSBNK-test-TST00001.txt',
    );
    expect(
      viaText.errors.some((e) => e.message.startsWith('ACCESSION mismatch')),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — module not found.

- [ ] **Step 3: Implement**

```ts
import type { InternalRecord } from '../record.ts';
import type { ValidationOptions, ValidationResult } from '../types.ts';
import { serializeRecord } from '../serializer/record-serializer.ts';
import { validateContent } from '../validator/validateContent.ts';

/**
 * Validate a structured record by serialising it and running the text rules.
 *
 * Delegates to validateContent rather than reimplementing anything, so the same
 * bytes get the same verdict through either entry point.
 *
 * Two limits worth knowing:
 *
 * The filename is derived from ACCESSION, because an InternalRecord has none.
 * AccessionMatchRule therefore cannot fail here — a green result is NOT evidence
 * that the accession matches any external filename. Use validate() or
 * validateContent() with the real filename for that.
 *
 * Mandatory fields and controlled vocabularies are NOT checked. A record
 * containing only ACCESSION returns success. Those rules arrive in later
 * releases; until then a green result means "round-trips and passes the current
 * rule set", not "submittable to MassBank".
 */
export async function validateRecord(
  record: InternalRecord,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  return validateContent(
    serializeRecord(record),
    `${record.ACCESSION}.txt`,
    options,
  );
}
```

- [ ] **Step 4: Verify** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/builder/ src/__tests__/builder/validate-record.test.ts
git commit -m "feat: add validateRecord for structured records"
```

---

### Task 4: Document the builder surface

**Files:** Modify `README.md`

- [ ] **Step 1: Add a Builder section** matching the README's existing voice and code-block style. Cover `buildRecord` (what it normalises, that duplicates are preserved, that it throws on an unhashable spectrum), `validateRecord` **including both stated limits**, and the new exports. Note that `Peak` and `SplashPeak` are different shapes both reachable from the root, and that `resolveSplashFromRecord` takes record _text_ while `validateRecord` takes a record _object_.

The README already carries a caveat for `validate` about mandatory fields not being enforced. Mirror it — shipping `validateRecord` as the builder's validation entry point without it is the misleading-green failure this plan is otherwise careful about.

- [ ] **Step 2: Verify** — `npm test` (prettier checks the README).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the record builder API"
```

---

## Verification when all tasks are done

```bash
npm test
npm pack --dry-run --no-ignore-scripts     # .npmrc sets ignore-scripts=true
```

Then prove the tests have teeth. Apply each, confirm RED, revert:

| Mutation                                                | Must fail                                    |
| ------------------------------------------------------- | -------------------------------------------- |
| Remove the peak sort                                    | 3 tests                                      |
| Reverse the sort to descending                          | 3 tests                                      |
| Sort by `intensity`                                     | 3 tests                                      |
| Trust `draft.PK$NUM_PEAK`                               | `derives PK$NUM_PEAK`                        |
| Compute `PK$SPLASH` only when absent                    | `recomputes PK$SPLASH`                       |
| Keep an empty `PK$ANNOTATION`                           | `drops an empty annotation table`            |
| Keep `PK$NUM_PEAK` when there are no peaks              | `drops PK$NUM_PEAK when there are no peaks`  |
| Sort the caller's array in place                        | `does not mutate its input`                  |
| Keep `_original` when rebuilding peaks                  | `strips _original`                           |
| Add dedupe                                              | `preserves duplicate m/z`                    |
| Catch the `RangeError` and omit SPLASH                  | `throws on a spectrum that cannot be hashed` |
| **Delete `export * from './builder/index.ts'`**         | `exports the builder surface`                |
| Drop the `options` pass-through                         | `passes options through to the rules`        |
| Make `validateRecord` return success without delegating | `detects a defect genuinely in the text`     |
| Pass a literal `'record.txt'` as the filename           | `cannot fail the accession check`            |

The bolded row **survived rev. 1** — the deliverable was unguarded because every test imported the deep relative path instead of the package root.

## Out of scope

- **Mandatory-field, CV, peak-order and duplicate rules** — B3/B4/B5.
- **The validity-profile knob** — B5, per D4.
- **`RecordValidator` / `IValidationRule` exports** — no injection point exists; adding them would freeze a broken extension contract. Revisit if rule injection is ever built.
- **Numeric formatting.** `1e+21` and `0.30000000000000004` survive `buildRecord` today. Deferred, but note this is the plan's own self-consistency-vs-correctness argument applied to numbers — a fixed point is not conformance.
- **The `PK$ANNOTATION` header shape.** The serializer emits a four-column header over rows that may carry one column. Self-consistent, unverified against the Java. Do not add annotation features until that is checked.
- **Annotations supplied without peaks** — currently emits an annotation table with no peak table and validates green. Unverified against the grammar.
