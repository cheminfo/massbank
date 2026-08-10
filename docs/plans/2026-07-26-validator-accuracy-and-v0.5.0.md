# MassBank Validator Accuracy — Implementation Plan (rev. 2, post-review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the validator rejecting officially published MassBank records, and lock its agreement with the Java original behind an automated two-sided test suite that can actually detect a regression.

**Architecture:** Release A (**v0.4.1**, this plan, fully detailed) is a pure bug-fix: it relocates the differential harness into the repo so it is versioned and runnable, fixes the two colon-handling defects that cause false rejections, and adds a mutation-based edge-case corpus. It changes no behaviour except turning wrongly-rejected records into accepted ones. Release B (**v0.5.0**, gated outline) adds the free-subtag warnings and the builder API — both of which change what consumers see and are therefore decoupled.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), ESM with explicit `.js` specifiers, vitest 4, eslint (`eslint-config-cheminfo-typescript`) + prettier. Java oracle = `massbank-lib` 1.0.17 via a `~/.m2` classpath. Node ≥ 20.

**Research basis:** `docs/plans/2026-07-26-ASSESSMENT-validator-accuracy.md` (defects D-1…D-4, deliberate divergences K-1…K-3) and `docs/plans/EXTRACTED-java-grammar-cv-reference.md` (verbatim Java vocabularies — **corrected 2026-07-26**; see its method warning).

## Architecture correction (rev. 3, user-directed 2026-07-26)

**The differential harness lives OUTSIDE the `massbank` repo**, at
`MassBank_P/Test/` (package `massbank-differential`, private, vitest + tsx). It was
briefly moved in during Task 1; that was wrong and has been reverted.

**Why outside:** `massbank` is a **published npm library**. It must not carry a
125-record corpus or a harness coupled to a Java/Maven toolchain it never otherwise
needs. Two-sided testing needs to reach _both_ the library and the Java oracle, so it
belongs in a project that sits above both. This also matches what the review already
established independently: the differential **cannot run in CI** (GitHub runners have no
`~/.m2` massbank-lib), so putting it in the repo bought nothing operationally.

**Consequences for this plan:**

- Task 1's deliverable is the external harness. The `massbank` repo gains **no**
  `differential/` directory, no vitest `projects` split, and no corpus. Its
  `.gitignore` / `.npmignore` / `eslint.config.js` / `tsconfig.json` stay untouched.
- The harness imports the library as `../../massbank/src/index.ts`, so it always tests
  the live working tree — no build, no `npm link`, no stale published copy.
- `feat/validator-accuracy` therefore contains only real library changes (Tasks 2–4, 6),
  which keeps the eventual PR reviewable and the published package clean.
- Run it with `cd Test && npm test` (vitest gate) or `npm run report` (full corpus report).

## What changed in rev. 2 (four independent reviews)

Each item below was found by review and is now fixed in the plan. Recorded so the same ground is not re-litigated.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                        | Resolution                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | `SubtagRule` warns on `MS_TYPE`/`ION_MODE` — **224 false positives on 112 records** (measured 3× independently). In the Java these are separate mandatory productions, never reaching the free-subtag fallback; the TS parser flattens them into one array.                                                                                                    | Rule moved to Release B **and** given an explicit skip set + a realistic-record regression test.                                                       |
| R2  | The differential compares category **sets**, so an over-warning rule is invisible to it — the gate could not detect R1.                                                                                                                                                                                                                                        | Release A adds per-category **counts** to the comparison.                                                                                              |
| R3  | "Warnings are non-blocking so it's safe" is **false end-to-end**: warnings feed `massSpecIssueCount`, flip the NoBS card from _Valid_ to _N issues_, and break two e2e specs.                                                                                                                                                                                  | Subtag warnings deferred to Release B, gated on NoBS gaining an advisory severity tier.                                                                |
| R4  | Verdict divergences carry **no category**, so the CDK-chemistry ones can never be allowlisted; Task 1's assertion and the exit gate were mutually exclusive.                                                                                                                                                                                                   | Verdict divergences are now categorised from the Java-side cause.                                                                                      |
| R5  | `Test/` has no vitest and **is not a git repo**; every `git add Test/…` fails and the root gate never sees it.                                                                                                                                                                                                                                                 | Harness moves into the repo as `differential/`, with a vitest project.                                                                                 |
| R6  | ~19 of 23 `invalid` mutations assert rules the port does not have (they test deferred D-4), so the suite could never go green.                                                                                                                                                                                                                                 | `phase: 1 \| 2` discriminant; only phase-1 is asserted, phase-2 is asserted to be _currently accepted_ so it flips loudly.                             |
| R7  | Every sample is CRLF; `missing-terminator` was a no-op, `crlf-line-endings` produced `\r\r\n`, `no-trailing-newline` became byte-identical.                                                                                                                                                                                                                    | Base record is LF-normalised at the boundary; regexes accept `\r?`.                                                                                    |
| R8  | `field-order-swapped` replaced the first space **in the document**, corrupting the record and passing vacuously.                                                                                                                                                                                                                                               | Rewritten as a line-index swap.                                                                                                                        |
| R9  | `it.each([])` passes silently (confirmed on vitest 4.0.8).                                                                                                                                                                                                                                                                                                     | Every `each` block gets a cardinality guard.                                                                                                           |
| R10 | `expect: 'valid'` / `'warns'` were never asserted — including the D-1 regression guard, the catalog's most valuable entry.                                                                                                                                                                                                                                     | Added assertion blocks for both.                                                                                                                       |
| R11 | K-1 (CRLF must stay silent) had **no test of the validator** — only of the allowlist data.                                                                                                                                                                                                                                                                     | Added a real unit test in `src/`.                                                                                                                      |
| R12 | Task 4's file failed `npm run eslint` (import order + 6 unused-param errors) and `prettier`.                                                                                                                                                                                                                                                                   | Release B carries the disable comments and a `prettier-write` step.                                                                                    |
| R13 | The extraction doc was missing `CAPILLARY_VOLTAGE` and the analyzer token `B` (constant-pool de-duplication).                                                                                                                                                                                                                                                  | **Doc corrected**; method warning added so it is not regenerated the same way.                                                                         |
| R14 | `MS_FOCUSED_ION_SUBTAGS` merged three different value grammars.                                                                                                                                                                                                                                                                                                | Release B keeps the verbatim 7 and exposes `ION_TYPE`/`PRECURSOR_TYPE` separately.                                                                     |
| R15 | Java matches listed subtags by **bare prefix** (`COLUMN_TEMPERATURE_GRADIENT` matches `COLUMN_TEMPERATURE` → Java silent, we would warn; occurs 3× in 300 records).                                                                                                                                                                                            | Release B mirrors prefix semantics.                                                                                                                    |
| R16 | `num-peak-mismatch` asked the port to reject what Java **accepts** (the check is dead code upstream).                                                                                                                                                                                                                                                          | Relabelled `expect: 'valid'` with the rationale.                                                                                                       |
| R17 | Mandatory list is **17**, not 16; catalog missed `MS_TYPE`, `ION_MODE`, `PK$PEAK`.                                                                                                                                                                                                                                                                             | Corrected; three mutations added.                                                                                                                      |
| R18 | release-please bumps **minor on `feat:`**, so Release A alone would have consumed 0.5.0.                                                                                                                                                                                                                                                                       | Release A is pure `fix:` → 0.4.1.                                                                                                                      |
| R19 | **Found during Task 1 execution, missed by all four reviews.** `missing-in-ts:free-subtag` is D-3, deferred to Release B, and produces 50 failures — but Task 1's per-record assertion is `expect(realDivergences).toEqual([])`, so the suite could never go green in Release A. Same contradiction class as R4, which was fixed only for `verdict:chemistry`. | Allowlisted with a new `until` field marking it TEMPORARY, so Release B must delete it rather than inherit a suppression that would hide a regression. |

**Verified sound by review, unchanged:** the D-1 diagnosis and fix (edit strings match live source exactly — the target block occurs exactly twice); the Task 2 round-trip literal is a **true fixed point** (executed pre-fix 2/3 fail, post-fix 3/3 pass, full suite 97 passed); D-2's case-insensitive key pattern; the K-1 CRLF call; and every "do not invent" claim, all confirmed against bytecode.

## Global Constraints

- **Browser compatibility is non-negotiable.** Never import `node:*` into `src/**` (except `src/validator/validate.ts`). The `differential/` harness is Node-only and is excluded from the package build and the browser gate.
- **The Java is the behavioural source of truth** — mirror it, do not invent. The three documented exceptions (K-1 `\r`, K-2 CDK chemistry, K-3 `FRAGMENTATION_MODE`) are deliberate.
- **Release A must not make any currently-accepted record newly rejected**, and must add no new warnings. It may only move records from wrongly-rejected to accepted. This is what makes it a safe patch release.
- **Commit types drive the release.** Release A uses `fix:`/`test:`/`chore:` **only** — a single `feat:` would bump the minor and consume 0.5.0. release-please owns `package.json` version and `CHANGELOG.md`; never hand-edit them.
- **ESM with explicit `.js` import specifiers** in `src/**`. The harness uses `.mts` and may import `.ts` directly.
- **Package gate:** `npm run test-only && npm run check-types && npm run eslint && npm run prettier`. `test-only` must **not** spawn JVMs — the differential runs under its own script.
- **Git (user-directed 2026-07-26):** `main` is never touched. All work lands on the feature branch **`feat/validator-accuracy`**. Each task runs on an ephemeral `gsd-tmp/<task>` branch (subagents commit freely there), then is harvested into `feat/validator-accuracy` via `git merge --squash` + one conventional commit per task. The ephemeral branch is deleted after harvest. **Never push**; the user raises the PR from `feat/validator-accuracy` → `main` when the branch is complete.
- **Do not modify `src/splash/**`\*\* — SPLASH has its own in-flight plan and its own oracle.

---

## File Structure

**Move (Task 1):** `../Test/` → `differential/` inside the repo.

- `differential/{findings,java-oracle,ts-validator,compare,report}.mts` — existing harness, relocated.
- `differential/log4j2.xml`, `differential/samples/**` (112 records + `error-tests/`).

**Create:**

- `differential/known-divergences.mts` — the K-1/K-2 allowlist.
- `differential/differential.test.mts` — the two-sided gate.
- `differential/fixtures/{mutations,generate}.mts`, `differential/fixtures/MSBNK-Test-TST00001.txt`.
- `differential/fixtures/__tests__/mutations.test.mts`.
- `src/__tests__/table-parsers.colon.test.ts`, `src/__tests__/crlf-silence.test.ts`.

**Modify:**

- `src/parser/table-parsers.ts` (D-1), `src/validation/rules/unrecognized-field-rule.ts` (D-2).
- `src/__tests__/unrecognized-field-rule.test.ts` (extend only).
- `vitest.config.ts` (projects), `package.json` (scripts only — never the version), `.npmignore`/`files`, `README.md`.

---

## Interfaces the plan shares

Harness (import, do not redefine): `findings.mts` → `Severity`, `Category`, `Finding`, `SideResult`, `categorize`, `CHEMISTRY_ONLY`. `java-oracle.mts` → `runJavaValidator`, `javaOracleAvailable`, `parseJavaOutput`. `ts-validator.mts` → `runTsValidator(filePath, content)`. `compare.mts` → `compareFile`, `ComparisonResult`, `Divergence`, `DivergenceKind`.

Package: `parseRecord(text): InternalRecord`, `serializeRecord(record): string`, `validateContent(content, filename, options?): Promise<ValidationResult>`, `InternalRecord`.

---

### Task 1: Relocate the harness into the repo and make it a real gate

Everything else depends on this: today the harness is unversioned, has no test runner, and its comparison cannot detect an over-warning rule.

**Files:**

- Move: `../Test/*` → `differential/` (keep `differential/samples/`)
- Create: `differential/known-divergences.mts`, `differential/differential.test.mts`
- Modify: `differential/compare.mts`, `vitest.config.ts`, `package.json` (scripts), `.npmignore`

**Interfaces:**

- Produces: `KnownDivergence { kind; category; reason }`, `KNOWN_DIVERGENCES`, `isKnownDivergence(kind, category)`.
- Modifies `Divergence` to always carry a `category`.

- [ ] **Step 1: Move the harness in**

```bash
git mv ../Test/differential differential 2>/dev/null || { mkdir -p differential && cp -R ../Test/differential/. differential/; }
mkdir -p differential/samples && cp -R ../Test/samples/. differential/samples/
rm -f differential/samples/.DS_Store
```

Fix the now-wrong relative import in `differential/ts-validator.mts`:

```ts
import { validateContent } from '../src/index.ts';
```

Add to `.npmignore` (so records never ship — `files` is `["lib","src"]`, but be explicit):

```
differential/
```

- [ ] **Step 2: Split vitest into projects so `test-only` never spawns a JVM**

In `vitest.config.ts`, replace the existing `test` block's `include` with projects:

```ts
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'differential',
          include: ['differential/**/*.test.mts'],
          testTimeout: 60_000,
        },
      },
    ],
```

In `package.json` `scripts`, keep `test-only` fast and add a separate entry (do **not** add it to `test`, which is the publish gate):

```json
    "test-only": "vitest run --project unit --coverage",
    "test-differential": "vitest run --project differential",
```

- [ ] **Step 3: Write the failing test**

Create `differential/differential.test.mts`:

```ts
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compareFile } from './compare.mts';
import { javaOracleAvailable } from './java-oracle.mts';
import { isKnownDivergence } from './known-divergences.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(HERE, 'samples');
const files = readdirSync(SAMPLES)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => join(SAMPLES, f));

describe('known divergences', () => {
  it('whitelists the Java CRLF non-standard-character false positive', () => {
    const hit = isKnownDivergence('missing-in-ts', 'non-standard-chars');
    expect(hit).toBeDefined();
    expect(hit?.reason).toMatch(/\\r|CRLF/i);
  });

  it('marks the free-subtag gap as temporary and Release-B-scoped', () => {
    const hit = isKnownDivergence('missing-in-ts', 'free-subtag');
    expect(hit).toBeDefined();
    expect(hit?.until).toMatch(/Release B/i);
  });

  it('does not whitelist a genuine defect', () => {
    expect(isKnownDivergence('extra-in-ts', 'num-peak')).toBeUndefined();
  });
});

// Outside skipIf: a missing Java oracle must not also hide the corpus check.
describe('corpus', () => {
  it('has records to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has a Java oracle (set MASSBANK_ALLOW_NO_ORACLE=1 to bypass)', () => {
    if (process.env.MASSBANK_ALLOW_NO_ORACLE === '1') return;
    expect(javaOracleAvailable()).toBe(true);
  });
});

describe.skipIf(!javaOracleAvailable())('two-sided validation', () => {
  it.each(files.map((f) => [f.split('/').pop() ?? f, f] as const))(
    '%s agrees with the Java oracle',
    async (_name, file) => {
      const result = await compareFile(file);
      expect(result.realDivergences.map((d) => d.detail)).toEqual([]);
    },
    60_000,
  );
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm run test-differential`
Expected: FAIL — cannot resolve `./known-divergences.mts`.

- [ ] **Step 5: Implement the allowlist**

Create `differential/known-divergences.mts`:

```ts
import type { Category } from './findings.mts';
import type { DivergenceKind } from './compare.mts';

/**
 * Divergences that are correct and must NOT be "fixed" by changing the port.
 * Entries stay visible in the report — this is documented suppression, not silence.
 */
export interface KnownDivergence {
  kind: DivergenceKind;
  category: Category;
  reason: string;
  /**
   * Set when the entry is TEMPORARY — a gap deliberately deferred to a later release
   * rather than a permanent divergence from the Java. The named release must delete the
   * entry; leaving it in place would silently hide a regression once the gap is closed.
   */
  until?: string;
}

export const KNOWN_DIVERGENCES: KnownDivergence[] = [
  {
    kind: 'missing-in-ts',
    category: 'non-standard-chars',
    reason:
      "Java's allowed-character class includes \\n but omits \\r, so it warns on every " +
      'CRLF record (112/112 of the corpus). The port allows \\r and is correctly silent. ' +
      'A category-level suppression is safe here precisely because the two character ' +
      'classes differ by nothing except \\r — a genuine offender (em-dash, bullet) is ' +
      'still flagged by both sides. Java itself normalises \\r\\n before its own ' +
      'round-trip comparison, so the warning is inconsistent with the rest of the CLI.',
  },
  {
    kind: 'verdict',
    category: 'chemistry',
    reason:
      'Java rejects on CDK checks (SMILES/InChI/formula cross-checks) that the port ' +
      'deliberately does not implement — see K-2. Requires a chemistry toolkit.',
  },
  {
    kind: 'missing-in-ts',
    category: 'free-subtag',
    reason:
      'D-3: the port has no subtag vocabulary yet, so it does not emit the ' +
      '"free subtag ... is not recomended" warning Java produces (50 records in the ' +
      'bundled corpus). This is a KNOWN GAP scheduled for Release B (SubtagRule), not a ' +
      'deliberate divergence — Release A simply does not close it.',
    until: 'Release B (v0.5.0) — delete this entry when SubtagRule lands',
  },
];

export function isKnownDivergence(
  kind: DivergenceKind,
  category: Category | undefined,
): KnownDivergence | undefined {
  if (category === undefined) return undefined;
  return KNOWN_DIVERGENCES.find(
    (k) => k.kind === kind && k.category === category,
  );
}
```

- [ ] **Step 6: Categorise verdict divergences and compare counts**

Two changes in `differential/compare.mts`.

(a) Give every verdict divergence a category, taken from the side that rejected, so a CDK-only rejection becomes allowlistable. Replace the verdict block:

```ts
if (java.valid !== ts.valid) {
  // Attribute the disagreement to whichever side rejected, so a Java-only CDK
  // rejection can be recognised as the expected chemistry gap rather than a defect.
  const blamed = java.valid ? ts : java;
  const cause = blamed.findings.find((f) => f.severity === 'error');
  divergences.push({
    kind: 'verdict',
    category: cause?.category ?? 'other',
    detail:
      `Java says ${java.valid ? 'VALID' : 'INVALID'} but the port says ` +
      `${ts.valid ? 'VALID' : 'INVALID'}` +
      (cause ? ` — ${cause.category}: ${cause.message.slice(0, 120)}` : ''),
  });
}
```

(b) Compare per-category **counts**, not just presence, so a rule that emits three warnings where Java emits one is caught (R2):

```ts
const countByCategory = (findings: Finding[]) => {
  const counts = new Map<Category, number>();
  for (const f of findings)
    counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  return counts;
};
const javaCounts = countByCategory(java.findings);
const tsCounts = countByCategory(ts.findings);

for (const [category, tsCount] of tsCounts) {
  const javaCount = javaCounts.get(category) ?? 0;
  if (javaCount > 0 && tsCount > javaCount) {
    divergences.push({
      kind: 'extra-in-ts',
      category,
      detail: `The port reports ${tsCount} "${category}" finding(s) where Java reports ${javaCount}`,
    });
  }
}
```

Add `Finding` to the `findings.mts` import. Finally apply the allowlist:

```ts
    realDivergences: divergences.filter(
      (d) => d.kind !== 'expected-chemistry-gap' && !isKnownDivergence(d.kind, d.category),
    ),
```

- [ ] **Step 7: Run — expect the D-1/D-2 failures, and record them**

Run: `npm run test-differential`
Expected: the allowlist and corpus suites PASS; per-record cases FAIL on D-1/D-2. That list is the baseline Tasks 2–3 drive to zero. **Do not weaken the assertion.** Note the failing count.

- [ ] **Step 8: Commit**

```bash
git add differential vitest.config.ts package.json .npmignore
git commit -m "test: bring the two-sided differential harness into the repo"
```

---

### Task 2: D-1 — table parsers must terminate on a field, not a colon

Verified by review: the target block occurs exactly twice in the live file, and the test literal below is a true fixed point of `serializeRecord ∘ parseRecord`.

**Files:**

- Modify: `src/parser/table-parsers.ts`
- Test: `src/__tests__/table-parsers.colon.test.ts` (create)

**Interfaces:** internal only — `FIELD_LINE_PATTERN`, `startsNewField(trimmedLine: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/table-parsers.colon.test.ts`. The annotation values are taken verbatim from `MSBNK-Chubu_Univ-UT001074`:

```ts
import { describe, expect, it } from 'vitest';

import { parseRecord } from '../parser/parse-record.js';
import { serializeRecord } from '../serializer/record-serializer.js';

// Lipid nomenclature puts a colon inside an annotation value. Terminating the table on
// any colon truncated the table and dropped every row that followed.
const RECORD = `ACCESSION: MSBNK-Test-TST00001
RECORD_TITLE: Test; LC-ESI-QTOF; MS2
DATE: 2024.01.01
AUTHORS: Test
LICENSE: CC BY
CH$NAME: Test
CH$FORMULA: C6H12O6
CH$EXACT_MASS: 180.0634
CH$SMILES: C
CH$IUPAC: InChI=1S/CH4/h1H4
AC$INSTRUMENT: Test
AC$INSTRUMENT_TYPE: LC-ESI-QTOF
AC$MASS_SPECTROMETRY: MS_TYPE MS2
AC$MASS_SPECTROMETRY: ION_MODE POSITIVE
PK$SPLASH: splash10-0000-0000000000-0000000000000000000
PK$ANNOTATION: m/z num type mass error(ppm) formula
  494.35 1 [lyso_PC(alkyl-18:0,-)]- 494.3610499491 -21 C25H53NO6P-
  510.33 2 [lyso_PC(18:1)+H]+ 510.3554 -3 C26H53NO7P+
PK$NUM_PEAK: 2
PK$PEAK: m/z int. rel.int.
  329.24 44.5 83
  343.08 12.5 23
//
`;

describe('table parsers with colons inside values', () => {
  it('keeps every annotation row when a value contains a colon', () => {
    const record = parseRecord(RECORD);
    expect(record.PK$ANNOTATION).toHaveLength(2);
    expect(record.PK$ANNOTATION?.[0]?.mz).toBe(494.35);
    expect(record.PK$ANNOTATION?.[1]?.mz).toBe(510.33);
  });

  it('still reads the fields that follow the annotation table', () => {
    const record = parseRecord(RECORD);
    expect(record.PK$NUM_PEAK).toBe(2);
    expect(record.PK$PEAK).toHaveLength(2);
  });

  it('round-trips exactly, so SerializationRule cannot reject it', () => {
    expect(serializeRecord(parseRecord(RECORD))).toBe(RECORD);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/__tests__/table-parsers.colon.test.ts`
Expected: **2 of the 3** fail — `PK$ANNOTATION` has length 0, and the round-trip differs. (The middle test passes even unfixed: the field parser recovers `PK$NUM_PEAK`/`PK$PEAK` on its own. It is kept because it guards the recovery path.)

- [ ] **Step 3: Implement**

In `src/parser/table-parsers.ts`, add above `abstract class BaseTableParser`:

```ts
/**
 * Matches the start of a new record field: an upper-case key (which may contain `_` or
 * `$`) immediately followed by a colon — `PK$NUM_PEAK:`, `RECORD_TITLE:`, `CH$NAME:`.
 *
 * Table rows must NOT be terminated on a bare `:`. Annotation values legitimately
 * contain colons — lipid nomenclature such as `[lyso_PC(alkyl-18:0,-)]-` is common
 * throughout MassBank. Breaking on any colon truncated the table, pushed the remaining
 * rows into the field parser as "unrecognized field", and made the round-trip check
 * reject officially published records (e.g. MSBNK-Chubu_Univ-UT001074).
 *
 * Peak and annotation rows always begin with a numeric m/z, so they can never match.
 * Trade-off: a malformed key containing `-` or `.` (`MS$FOCUSED-ION:`) no longer ends
 * the table and is swallowed by the row parser. SerializationRule still rejects such a
 * record, so nothing is silently accepted — only the diagnostic is less precise.
 */
const FIELD_LINE_PATTERN = /^[A-Z][A-Z0-9_$]*:/;

function startsNewField(trimmedLine: string): boolean {
  return FIELD_LINE_PATTERN.test(trimmedLine);
}
```

Then in **both** `PeakTableParser.parse` and `AnnotationTableParser.parse` replace:

```ts
// Check if this is a new key-value pair (next section)
if (line.includes(':')) {
  break;
}
```

with:

```ts
// Stop at the next record field, not at any colon (see FIELD_LINE_PATTERN).
if (startsNewField(line)) {
  break;
}
```

- [ ] **Step 4: Run to green, then the full gate**

Run: `npx vitest run --project unit src/__tests__/table-parsers.colon.test.ts` → 3/3 PASS.
Run: `npm run test-only` → expect **97 passed** (94 pre-existing + 3 new).
Run: `npm run check-types && npm run eslint && npm run prettier` → clean.

- [ ] **Step 5: Confirm against the corpus**

Run: `npm run test-differential`
Expected: `extra-in-ts:serialization` failures drop sharply. Record the remaining count.

- [ ] **Step 6: Commit**

```bash
git add src/parser/table-parsers.ts src/__tests__/table-parsers.colon.test.ts
git commit -m "fix: keep table rows whose values contain colons"
```

---

### Task 3: D-2 — `UnrecognizedFieldRule` must match a field key shape

**Files:**

- Modify: `src/validation/rules/unrecognized-field-rule.ts`
- Test: `src/__tests__/unrecognized-field-rule.test.ts` (extend — do not touch existing cases)

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('UnrecognizedFieldRule', …)`:

```ts
it('does not treat a table row containing a colon as a field', () => {
  const text = `ACCESSION: TEST
PK$ANNOTATION: m/z num type
  494.35 1 [lyso_PC(alkyl-18:0,-)]-
//`;

  const warnings = rule.getWarnings(dummyRecord, text, 'test.txt');

  expect(warnings).toHaveLength(0);
});

it('still reports a mis-cased field key', () => {
  const text = `ACCESSION: TEST
record_title: lower case key
//`;

  const warnings = rule.getWarnings(dummyRecord, text, 'test.txt');

  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.message).toContain('record_title');
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `npx vitest run --project unit src/__tests__/unrecognized-field-rule.test.ts`
Expected: the table-row case FAILS with a warning about `494.35 1 [lyso_PC(alkyl-18`.

- [ ] **Step 3: Implement**

Add above the class in `src/validation/rules/unrecognized-field-rule.ts`:

```ts
/**
 * A field line is a key — letters, digits, `_`, `$`, no spaces — followed immediately by
 * a colon. Matching the first colon anywhere instead misreads table rows whose values
 * contain colons: `494.35 1 [lyso_PC(alkyl-18:0,-)]-` produced a bogus
 * "Unrecognized field '494.35 1 [lyso_PC(alkyl-18'" on published records.
 *
 * The leading letter is matched case-insensitively on purpose: a mis-cased key such as
 * `record_title:` is exactly the typo this rule exists to report. Table rows always
 * start with a numeric m/z, so they can never match.
 */
const FIELD_LINE_PATTERN = /^(?<key>[A-Za-z][A-Za-z0-9_$]*):/;
```

and in `getWarnings` replace:

```ts
const colonIndex = line.indexOf(':');
if (colonIndex === -1) {
  continue;
}

const key = line.slice(0, colonIndex).trim();
```

with:

```ts
const fieldMatch = FIELD_LINE_PATTERN.exec(line);
if (!fieldMatch) {
  continue;
}

const key = fieldMatch.groups?.key ?? '';
```

(The named group keeps `prefer-named-capture-group` quiet.)

- [ ] **Step 4: Run to green + full gate**

Run: `npx vitest run --project unit src/__tests__/unrecognized-field-rule.test.ts` → **6/6** PASS.
Run: `npm run test-only && npm run check-types && npm run eslint && npm run prettier` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/validation/rules/unrecognized-field-rule.ts src/__tests__/unrecognized-field-rule.test.ts
git commit -m "fix: identify field lines by key shape, not first colon"
```

---

### Task 4: K-1 regression test — CRLF must stay silent

The `\r` allowance lives in a single character class. One well-meaning "mirror the Java exactly" edit re-introduces a warning on ~90% of real records, and today **no test would catch it**.

**Files:** Create `src/__tests__/crlf-silence.test.ts`

- [ ] **Step 1: Write the test (it should pass immediately — it is a guard, not a fix)**

```ts
import { describe, expect, it } from 'vitest';

import { validateContent } from '../validator/validateContent.js';

// K-1: the Java's allowed-character class includes \n but omits \r, so it warns on every
// CRLF record. That is a bug in the original and is deliberately NOT mirrored. This test
// exists so the deliberate divergence cannot be silently undone.
const RECORD = `ACCESSION: MSBNK-Test-TST00001
RECORD_TITLE: Test; LC-ESI-QTOF; MS2
DATE: 2024.01.01
AUTHORS: Test
LICENSE: CC BY
CH$NAME: Test
CH$FORMULA: C6H12O6
CH$EXACT_MASS: 180.0634
CH$SMILES: C
CH$IUPAC: InChI=1S/CH4/h1H4
AC$INSTRUMENT: Test
AC$INSTRUMENT_TYPE: LC-ESI-QTOF
AC$MASS_SPECTROMETRY: MS_TYPE MS2
AC$MASS_SPECTROMETRY: ION_MODE POSITIVE
PK$NUM_PEAK: 2
PK$PEAK: m/z int. rel.int.
  329.24 44.5 83
  343.08 12.5 23
//
`;

describe('CRLF handling (K-1)', () => {
  it('does not warn about non-standard characters for CRLF line endings', async () => {
    const crlf = RECORD.replace(/\n/g, '\r\n');
    const result = await validateContent(crlf, 'MSBNK-Test-TST00001.txt');

    expect(
      result.warnings.filter((w) => /non[- ]standard/i.test(w.message)),
    ).toHaveLength(0);
  });

  it('treats LF and CRLF as equivalent', async () => {
    const lf = await validateContent(RECORD, 'MSBNK-Test-TST00001.txt');
    const crlf = await validateContent(
      RECORD.replace(/\n/g, '\r\n'),
      'MSBNK-Test-TST00001.txt',
    );

    expect(crlf.success).toBe(lf.success);
    expect(crlf.errors.map((e) => e.type)).toEqual(
      lf.errors.map((e) => e.type),
    );
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run --project unit src/__tests__/crlf-silence.test.ts`
Expected: PASS. If it fails, the `\r` allowance has already been lost — fix `src/validation/rules/non-standard-chars-rule.ts` before proceeding.

- [ ] **Step 3: Prove it guards**

Temporarily delete `\r` from the character class in `non-standard-chars-rule.ts`, re-run, confirm the first test FAILS, then restore. This verifies the guard has teeth rather than passing vacuously.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/crlf-silence.test.ts
git commit -m "test: guard the deliberate CRLF divergence from the Java validator"
```

---

### Task 5: Mutation-based edge-case corpus

One named mutation per error class, applied to a base record both validators accept. `phase` separates what the port must already do from what Release B will add, so the suite is green now and flips loudly later.

**Files:**

- Create: `differential/fixtures/MSBNK-Test-TST00001.txt`, `differential/fixtures/mutations.mts`, `differential/fixtures/generate.mts`
- Create: `differential/fixtures/__tests__/mutations.test.mts`
- Modify: `differential/samples/error-tests/MSBNK-TEST-GOOD001.txt`, `…/MSBNK-TEST-PASS_VALID.txt`

**Interfaces:**

- Produces: `Mutation { name; description; expect: 'valid'|'invalid'|'warns'; phase: 1|2; mutate(text): string }`, `MUTATIONS`, `applyMutation(base, m)`.

- [ ] **Step 1: Create the base record**

The base must be **accession-named** (`AccessionMatchRule` compares ACCESSION to the filename basename, so `base-record.txt` can never validate) and **LF-normalised** (every sample is CRLF, which breaks three mutations).

```bash
mkdir -p differential/fixtures
sed 's/\r$//' differential/samples/MSBNK-Athens_Univ-AU100601.txt \
  | sed 's/^ACCESSION: .*/ACCESSION: MSBNK-Test-TST00001/' \
  | sed 's/^RECORD_TITLE: \(.*\)/RECORD_TITLE: \1/' \
  > differential/fixtures/MSBNK-Test-TST00001.txt
```

Verify it is clean on **both** sides before continuing — the whole task depends on it:

```bash
cat > /tmp/checkbase.mts <<'EOF'
import { compareFile } from '../differential/compare.mts';
const r = await compareFile('differential/fixtures/MSBNK-Test-TST00001.txt');
console.log('java', r.java.valid, 'ts', r.ts.valid, 'divergences', r.realDivergences);
EOF
npx tsx /tmp/checkbase.mts
```

Expected: `java true ts true divergences []`. If the record carries a `PK$ANNOTATION` table, pick a base without one — the `annotation-colon-in-value` mutation appends a second table, and the parser keeps only the last.

- [ ] **Step 2: Write the failing test**

Create `differential/fixtures/__tests__/mutations.test.mts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runTsValidator } from '../../ts-validator.mts';
import { MUTATIONS, applyMutation } from '../mutations.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(join(HERE, '..', 'MSBNK-Test-TST00001.txt'), 'utf8');
const FILENAME = 'MSBNK-Test-TST00001.txt';

const phase1 = (e: Mutation['expect']) =>
  MUTATIONS.filter((m) => m.phase === 1 && m.expect === e);
type Mutation = (typeof MUTATIONS)[number];

describe('mutation catalog', () => {
  it('names are unique and the catalog is non-trivial', () => {
    const names = MUTATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  it('every mutation actually changes the record', () => {
    for (const m of MUTATIONS) {
      expect(applyMutation(BASE, m), m.name).not.toBe(BASE);
    }
  });

  // Cardinality guards: it.each([]) passes silently on vitest 4.
  it('has phase-1 cases in every expectation bucket', () => {
    expect(phase1('invalid').length).toBeGreaterThan(0);
    expect(phase1('valid').length).toBeGreaterThan(0);
    expect(phase1('warns').length).toBeGreaterThan(0);
  });

  it('has phase-2 cases documenting deferred rules', () => {
    expect(MUTATIONS.filter((m) => m.phase === 2).length).toBeGreaterThan(0);
  });
});

describe('phase 1 — the port must already behave this way', () => {
  it.each(phase1('invalid'))('$name is rejected', async (m) => {
    const r = await runTsValidator(FILENAME, applyMutation(BASE, m));
    expect(r.valid, `${m.name}: ${m.description}`).toBe(false);
  });

  it.each(phase1('valid'))('$name stays fully valid', async (m) => {
    const r = await runTsValidator(FILENAME, applyMutation(BASE, m));
    expect(r.valid, `${m.name}: ${m.description}`).toBe(true);
  });

  it.each(phase1('warns'))('$name warns without rejecting', async (m) => {
    const r = await runTsValidator(FILENAME, applyMutation(BASE, m));
    expect(r.valid, m.name).toBe(true);
    expect(
      r.findings.some((f) => f.severity === 'warning'),
      m.name,
    ).toBe(true);
  });
});

// These document rules the port does NOT yet have. Asserting they are currently
// ACCEPTED means the day Release B lands, these fail loudly and get promoted to phase 1.
describe('phase 2 — deferred rules, currently accepted', () => {
  it.each(MUTATIONS.filter((m) => m.phase === 2))(
    '$name is still accepted (promote when the rule lands)',
    async (m) => {
      const r = await runTsValidator(FILENAME, applyMutation(BASE, m));
      expect(r.valid, `${m.name}: ${m.description}`).toBe(true);
    },
  );
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test-differential`
Expected: FAIL — cannot resolve `../mutations.mts`.

- [ ] **Step 4: Implement the catalog**

Create `differential/fixtures/mutations.mts`:

```ts
/**
 * Single-purpose mutations applied to a base record BOTH validators accept, so a failure
 * names the defect directly.
 *
 * `expect` is the intent for the TypeScript port:
 *   'invalid' — must be rejected
 *   'warns'   — must stay valid and raise at least one warning
 *   'valid'   — must remain fully clean (regression guards)
 * `phase` is when that becomes true:
 *   1 — the port already behaves this way
 *   2 — deferred to Release B's mandatory-field / CV rules; asserted as *accepted* today
 */

export interface Mutation {
  name: string;
  description: string;
  expect: 'valid' | 'invalid' | 'warns';
  phase: 1 | 2;
  mutate(text: string): string;
}

/** Every sample on disk is CRLF; normalise so the line-oriented mutations behave. */
const normalizeEol = (t: string): string => t.replace(/\r\n?/g, '\n');

const removeField = (key: string) => (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.startsWith(`${key}:`))
    .join('\n');

/** Removes one `AC$MASS_SPECTROMETRY: <SUBTAG> …` line, not the whole field. */
const removeSubtag = (subtag: string) => (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.startsWith(`AC$MASS_SPECTROMETRY: ${subtag} `))
    .join('\n');

const replaceField = (key: string, value: string) => (text: string) =>
  text
    .split('\n')
    .map((l) => (l.startsWith(`${key}:`) ? `${key}: ${value}` : l))
    .join('\n');

const swapLines = (keyA: string, keyB: string) => (text: string) => {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${keyA}:`));
  const j = lines.findIndex((l) => l.startsWith(`${keyB}:`));
  if (i === -1 || j === -1) return text;
  const tmp = lines[i] as string;
  lines[i] = lines[j] as string;
  lines[j] = tmp;
  return lines.join('\n');
};

export function applyMutation(base: string, mutation: Mutation): string {
  return mutation.mutate(normalizeEol(base));
}

export const MUTATIONS: Mutation[] = [
  // ---- mandatory fields: 17 required, in a fixed order (Java is a sequence parser) ----
  {
    name: 'missing-accession',
    description: 'ACCESSION removed',
    expect: 'invalid',
    phase: 1,
    mutate: removeField('ACCESSION'),
  },
  {
    name: 'missing-record-title',
    description: 'RECORD_TITLE removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('RECORD_TITLE'),
  },
  {
    name: 'missing-date',
    description: 'DATE removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('DATE'),
  },
  {
    name: 'missing-authors',
    description: 'AUTHORS removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('AUTHORS'),
  },
  {
    name: 'missing-license',
    description: 'LICENSE removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('LICENSE'),
  },
  {
    name: 'missing-ch-name',
    description: 'CH$NAME removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('CH$NAME'),
  },
  {
    name: 'missing-ch-formula',
    description: 'CH$FORMULA removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('CH$FORMULA'),
  },
  {
    name: 'missing-ch-exact-mass',
    description: 'CH$EXACT_MASS removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('CH$EXACT_MASS'),
  },
  {
    name: 'missing-ch-smiles',
    description: 'CH$SMILES removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('CH$SMILES'),
  },
  {
    name: 'missing-ch-iupac',
    description: 'CH$IUPAC removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('CH$IUPAC'),
  },
  {
    name: 'missing-ac-instrument',
    description: 'AC$INSTRUMENT removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('AC$INSTRUMENT'),
  },
  {
    name: 'missing-ac-instrument-type',
    description: 'AC$INSTRUMENT_TYPE removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('AC$INSTRUMENT_TYPE'),
  },
  {
    name: 'missing-ms-type',
    description: 'AC$MASS_SPECTROMETRY: MS_TYPE removed (mandatory production)',
    expect: 'invalid',
    phase: 2,
    mutate: removeSubtag('MS_TYPE'),
  },
  {
    name: 'missing-ion-mode',
    description:
      'AC$MASS_SPECTROMETRY: ION_MODE removed (mandatory production)',
    expect: 'invalid',
    phase: 2,
    mutate: removeSubtag('ION_MODE'),
  },
  {
    name: 'missing-pk-splash',
    description: 'PK$SPLASH removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('PK$SPLASH'),
  },
  {
    name: 'missing-pk-num-peak',
    description: 'PK$NUM_PEAK removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('PK$NUM_PEAK'),
  },
  {
    name: 'missing-pk-peak',
    description: 'PK$PEAK header removed',
    expect: 'invalid',
    phase: 2,
    mutate: removeField('PK$PEAK'),
  },
  {
    name: 'missing-terminator',
    description: 'trailing // removed',
    expect: 'invalid',
    phase: 1,
    mutate: (t) => t.replace(/\/\/\r?\n?$/, ''),
  },
  {
    name: 'no-trailing-newline',
    description: 'final newline removed',
    expect: 'invalid',
    phase: 1,
    mutate: (t) => t.replace(/\n$/, ''),
  },

  // ---- ordering ----
  {
    name: 'field-order-swapped',
    description: 'DATE emitted before RECORD_TITLE',
    expect: 'invalid',
    phase: 1,
    mutate: swapLines('RECORD_TITLE', 'DATE'),
  },

  // ---- ACCESSION ----
  {
    name: 'accession-filename-mismatch',
    description: 'ACCESSION differs from the filename',
    expect: 'invalid',
    phase: 1,
    mutate: replaceField('ACCESSION', 'MSBNK-Test-TST99999'),
  },
  {
    name: 'accession-two-segments',
    description:
      'ACCESSION has two segments; today only trips the filename check, so the ACCESSION grammar itself is still unverified',
    expect: 'invalid',
    phase: 1,
    mutate: replaceField('ACCESSION', 'NOBSDEV-20260726'),
  },

  // ---- controlled vocabularies ----
  {
    name: 'invalid-license',
    description: 'LICENSE outside license.ini',
    expect: 'invalid',
    phase: 2,
    mutate: replaceField('LICENSE', 'WTFPL'),
  },
  {
    name: 'valid-license-cc-by-nc-nd',
    description: 'CC BY-NC-ND is legal and must be accepted',
    expect: 'valid',
    phase: 1,
    mutate: replaceField('LICENSE', 'CC BY-NC-ND'),
  },
  {
    name: 'valid-license-dl-de',
    description: 'dl-de/by-2-0 is legal and must be accepted',
    expect: 'valid',
    phase: 1,
    mutate: replaceField('LICENSE', 'dl-de/by-2-0'),
  },
  {
    name: 'invalid-instrument-type',
    description: 'AC$INSTRUMENT_TYPE with no ionisation token',
    expect: 'invalid',
    phase: 2,
    mutate: replaceField('AC$INSTRUMENT_TYPE', 'NOT-AN-INSTRUMENT'),
  },
  {
    name: 'instrument-type-magnetic-sector',
    description: 'B (magnetic sector) is a legal analyzer token',
    expect: 'valid',
    phase: 1,
    mutate: replaceField('AC$INSTRUMENT_TYPE', 'EI-B'),
  },

  // ---- peak semantics ----
  {
    name: 'peaks-unsorted',
    description: 'peak list not strictly ascending by m/z',
    expect: 'invalid',
    phase: 2,
    mutate: (t) => {
      const lines = t.split('\n');
      const start = lines.findIndex((l) => l.startsWith('PK$PEAK:'));
      if (start === -1 || lines[start + 2] === undefined) return t;
      const a = lines[start + 1] as string;
      lines[start + 1] = lines[start + 2] as string;
      lines[start + 2] = a;
      return lines.join('\n');
    },
  },
  // Java's own PK$NUM_PEAK check is dead code (PK_NUM_PEAK() returns PK$PEAK.size(), so
  // it compares a value with itself). The declared value is parsed and re-emitted
  // verbatim, so a wrong count round-trips cleanly and BOTH validators accept it.
  // The guarantee belongs in buildRecord, not in a validation rule.
  {
    name: 'num-peak-mismatch',
    description:
      'PK$NUM_PEAK disagrees with the row count — accepted by Java too',
    expect: 'valid',
    phase: 1,
    mutate: replaceField('PK$NUM_PEAK', '9999'),
  },

  // ---- characters / unknown fields ----
  {
    name: 'em-dash',
    description: 'U+2014 in a value',
    expect: 'warns',
    phase: 1,
    mutate: (t) => t.replace(/^AUTHORS:.*$/m, 'AUTHORS: A—B'),
  },
  // The parser drops unrecognised keys entirely, so the serializer omits them and the
  // round-trip check rejects the record. These are 'invalid', not merely 'warns'.
  {
    name: 'unknown-field',
    description: 'a field key outside the 2.6.0 set',
    expect: 'invalid',
    phase: 1,
    mutate: (t) => t.replace(/^(DATE:.*)$/m, '$1\nNOT_A_FIELD: x'),
  },
  {
    name: 'typo-field',
    description: 'RECRD_TITLE should suggest RECORD_TITLE',
    expect: 'invalid',
    phase: 1,
    mutate: (t) => t.replace(/^(DATE:.*)$/m, '$1\nRECRD_TITLE: x'),
  },
  {
    name: 'crlf-line-endings',
    description: 'K-1: CRLF must stay valid and silent',
    expect: 'valid',
    phase: 1,
    mutate: (t) => t.replace(/\n/g, '\r\n'),
  },

  // ---- regression guard for the defect this release fixes ----
  {
    name: 'annotation-colon-in-value',
    description:
      'D-1: lipid nomenclature with a colon must not truncate the table',
    expect: 'valid',
    phase: 1,
    mutate: (t) =>
      t.replace(
        /^(PK\$NUM_PEAK:.*)$/m,
        'PK$ANNOTATION: m/z num type\n  494.35 1 [lyso_PC(alkyl-18:0,-)]-\n$1',
      ),
  },
];
```

- [ ] **Step 5: Run to green**

Run: `npm run test-differential`
Expected: PASS. A phase-2 case that now **fails** means the port already rejects it — promote it to `phase: 1` (that is a genuine, welcome finding). A phase-1 case that fails is a real defect: fix the port or correct the expectation, but **never** delete the case.

- [ ] **Step 6: Correct the two mislabelled fixtures**

`differential/samples/error-tests/MSBNK-TEST-GOOD001.txt` and `MSBNK-TEST-PASS_VALID.txt` are named as positive controls but are rejected by the Java: their `RECORD_TITLE` lacks the mandatory `<name>; <instrument-type>; <ms-type>` structure. Give both a conformant title, e.g.:

```
RECORD_TITLE: Test Compound; LC-ESI-QTOF; MS2
```

Run: `npx tsx differential/report.mts differential/samples/error-tests`
Expected: neither file appears under VERDICT DISAGREEMENTS.

- [ ] **Step 7: Add the generator**

Create `differential/fixtures/generate.mts` so mutated records exist on disk for the Java side and for manual inspection:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUTATIONS, applyMutation } from './mutations.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(join(HERE, 'MSBNK-Test-TST00001.txt'), 'utf8');
const OUT = join(HERE, '..', 'samples', 'generated');

// One directory per mutation, each holding an accession-named file so
// AccessionMatchRule behaves exactly as it would for a real submission.
for (const mutation of MUTATIONS) {
  const dir = join(OUT, mutation.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'MSBNK-Test-TST00001.txt'),
    applyMutation(BASE, mutation),
  );
}
console.log(`Generated ${MUTATIONS.length} mutated record(s) under ${OUT}`);
```

Add `differential/samples/generated/` to `.gitignore`, then:

Run: `npx tsx differential/fixtures/generate.mts && npx tsx differential/report.mts differential/samples/generated`
This is the two-sided pass over the catalog; review the divergence list and record it.

- [ ] **Step 8: Full gate + commit**

```bash
npm run test-only && npm run check-types && npm run eslint && npm run prettier
npm run test-differential
git add differential .gitignore
git commit -m "test: mutation-based edge-case corpus for two-sided validation"
```

---

### Task 6: README + release notes for v0.4.1

**Files:** Modify `README.md`. **Do not touch `package.json` version or `CHANGELOG.md`** — release-please owns both.

- [ ] **Step 1: Update the validation-rules and Node-version sections**

`README.md` documents the rule set and says "Node.js 18+" while `engines` requires `>=20`. Correct the Node floor, and add a short note that records whose annotation values contain colons (lipid nomenclature) are now parsed correctly.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note the colon-in-annotation fix and correct the Node floor"
```

---

## Release A exit gate (v0.4.1)

- [ ] `npm run test-only && npm run check-types && npm run eslint && npm run prettier` clean.
- [ ] `npm run test-differential` green.
- [ ] `npx tsx differential/report.mts differential/samples` → **`extra-in-ts` = 0**.
      Surviving divergences, all expected and all still printed by the report (allowlisting
      suppresses failure, not visibility): - `missing-in-ts:free-subtag` — temporary, `until` Release B. - `verdict:chemistry` — permanent (K-2). **Note: 0 occurrences in the bundled corpus**;
      the CDK disagreements were measured on the larger `MassBank-data` sample, so this
      entry is unexercised here. Do not treat its absence as a regression. - `missing-in-ts:parse` (13) and `verdict:parse` (4) from `samples/error-tests/` —
      these are LF-only synthetic fixtures that Java rejects on `'\r' expected`, i.e.
      **K-1 again**, not defects. They appear only in `report.mts` (recursive), not in the
      vitest gate (non-recursive, top level only — see Task 1 note). **Task 5 owns them**
      and normalises the fixtures; do not add a `verdict:parse` allowlist, which would be
      far too broad to be safe.
- [ ] **`npm run test-differential` is a human-run gate, not CI.** The shared zakodium
      workflow's runners have no `~/.m2` massbank-lib, so the Java oracle is unavailable
      there and the suite skips. Run it locally before every squash-merge; regressions in
      Tasks 2–5 are otherwise caught by nobody.
- [ ] Re-run against a fresh stratified sample from `MassBank/MassBank-data` (≥300 records, ≥10 contributors) and record the agreement ratio.
- [ ] Every commit is `fix:`/`test:`/`docs:`/`chore:` — **no `feat:`** (a `feat:` bumps the minor and consumes 0.5.0).

---

# Release B — v0.5.0 (gated outline)

**Entry gate:** Release A shipped. **Detail level:** step-level, written once A lands.

**B0 — NoBS-side prerequisite (blocks B1).** Subtag warnings are advisory and often un-actionable (`FRAGMENTATION_MODE` is legitimate and pervasive; its vocabulary is commented out upstream). Today NoBS counts every warning into `massSpecIssueCount`, flips the card from _Valid_ to _N issues_, renders "N to fix", and two e2e specs assert `Valid` on a fixture containing `FRAGMENTATION_MODE`. Before B1 ships, NoBS needs an **advisory tier** excluded from the issue count and badge, plus those specs updated. Without it, B1 tells users to fix something they cannot.

**B1 — free-subtag warnings (D-3).** `src/cv/subtags.ts` + `SubtagRule`. Must:

- **Skip `MS_TYPE` and `ION_MODE`** — separate mandatory productions in the Java, never reaching the free-subtag fallback. The TS parser flattens them into the same array, so without a skip set the rule fires on 100% of records (measured: 224 false positives on 112 records).
- **Mirror Java's prefix matching** — listed subtags match by bare prefix with no word boundary, so `COLUMN_TEMPERATURE_GRADIENT` matches `COLUMN_TEMPERATURE` and Java stays silent (3 occurrences in 300 records). Skip a subtag when any listed member is a prefix of it.
- Warn **only** for `AC$MASS_SPECTROMETRY` and `AC$CHROMATOGRAPHY` (open). `MS$FOCUSED_ION` (7 members) and `MS$DATA_PROCESSING` (12) are **closed** — an unknown subtag is a hard parse failure in Java, so warning would misrepresent it.
- Keep `MS_FOCUSED_ION_SUBTAGS` at the verbatim **7**; expose `ION_TYPE` (closed, 52 distinct) and `PRECURSOR_TYPE` (generative adduct grammar) separately — they have different value grammars and the builder's field editor needs the distinction.
- Mirror the message byte-exactly, including the upstream `recomended` typo, and fire **once per occurrence**.
- Carry `eslint-disable-next-line @typescript-eslint/no-unused-vars` on unused rule params and put value imports before type imports, matching sibling rules; run `prettier-write` before committing.
- Ship an **integration test through `validateContent`** asserting the warning appears _and_ `success` stays `true` — unit tests on the class alone leave registration unguarded.

**B2 — builder API.** Exports (`serializeRecord`, `parseRecord`, `InternalRecord`, `RecordValidator`, `IValidationRule`) + sub-path `exports` + `sideEffects: false`; `buildRecord(partial)` (normalise, derive `PK$NUM_PEAK = peaks.length`, compute `PK$SPLASH`, sort peaks strictly ascending, drop empty tables, guarantee serializer-idempotence); `validateRecord(record, options)`.

**B3 — mandatory-field + ordering rule (D-4).** The **17** required fields in their fixed sequence, plus the `DEPRECATED` short-circuit. Promotes ~15 phase-2 mutations to phase 1.

**B4 — CV module.** LICENSE (7), MS*TYPE (6), ION_MODE (2), CH$LINK (18), `AC$INSTRUMENT_TYPE`grammar (**analyzer tokens`B, E, FT, IT, Q, TOF`** — `B`was missing from the first extraction), PRECURSOR_TYPE adduct grammar incl. the`1+`/`1-`prohibition, ION_TYPE (52), ACCESSION regex`/^\w{1,10}-\w{1,32}-[A-Z0-9*]{1,64}$/`.

**B5 — portable semantic rules.** Peak sort strict / annotation sort non-strict, CH$NAME duplicates, CH$LINK duplicate keys, length caps (RECORD_TITLE/PUBLICATION/COMMENT 600, CH$SMILES 1200), strict `uuuu.MM.dd` DATE, ChemOnt regex, the `N/A` sentinel conditionals.

**B6 — unknown-field preservation.** Parser + serializer, so zero-metadata-loss survives a round trip. Store each unrecognised line with the key it followed; re-emit at that anchor. Note this changes `unknown-field`/`typo-field` from `invalid` to `warns`.

**Validity profiles (supersedes the earlier OQ-B split).** Strictness must not depend on _which function you call_ — `validateRecord` serialises and delegates to `validateContent`, so the same bytes would be valid via one entry point and invalid via the other. Use one explicit knob with the same default on both:

```ts
validateContent(text, filename, { profile: 'lenient' | 'submission' });
validateRecord(record, { profile: 'lenient' | 'submission' });
```

Default `'lenient'` through 0.x (no breaking change); flip at 1.0 as a documented break. Validity then belongs to the profile, which is nameable in docs and in NoBS's UI ("parses" vs "ready for MassBank submission").

**Other decisions.** **OQ-A** — MGF import stays app-side; `mgf-parser` in a MassBank-_format_ library widens its purpose for something not blocking. **OQ-C** — ship vocabularies + advisory warnings first, defer hard CV rejection until warning volume is measured against the corpus.

**Explicitly NOT ported (K-2):** CDK chemistry — formula round-trip, SMILES parsing/wildcards, InChI→structure, the three InChIKey/formula cross-checks.

**Do not invent** (each confirmed against bytecode): a `MS_TYPE != MS ⇒ MS$FOCUSED_ION required` rule; `INLET_TYPE`; an enforced `FRAGMENTATION_MODE` vocabulary; alphabetical subtag ordering; a live `PK$NUM_PEAK` mismatch check.

**NoBS follow-ups (tracked separately).** Its hand-written `cv.ts`/`mandatoryFieldRule.ts` have live defects: `LICENSE` missing `CC BY-NC-ND` and `dl-de/by-2-0` (**valid licences rejected today**), `CH$COMPOUND_CLASS` gated as mandatory though optional in Java, invented `INLET_TYPE`, `SIMS` for `SI`, and an invented MS2-precursor requirement. Bumping `massbank` in `backend/package.json` and `frontend/package.json` is required — `^0.4.0` will not pick up 0.5.0 automatically.

---

## Self-Review

**Spec coverage.** D-1 → Task 2; D-2 → Task 3; K-1 → Task 4; harness/gate → Task 1; edge cases → Task 5; D-3 → B1; D-4 → B3. Every review finding R1–R18 is resolved in the table above and reflected in the task bodies.

**Placeholder scan.** All code steps are complete and runnable. Task 5 Step 1 verifies rather than assumes the base record, with an explicit pass criterion and a stated fallback.

**Type consistency.** `Mutation`/`MUTATIONS`/`applyMutation` are consistent across Steps 2, 4 and 7. `KnownDivergence`/`isKnownDivergence` match between Task 1 Steps 5 and 6. `Divergence` now always carries `category`, which the allowlist and the count comparison both rely on. `FIELD_LINE_PATTERN` is uppercase-only in Task 2 (conservative table termination) and case-insensitive in Task 3 (to preserve mis-cased-key detection) — documented in place so the difference is not read as an inconsistency.

**Risk.** Release A adds no warnings and rejects nothing new, so no consumer verdict can change except a wrongly-rejected record becoming accepted. The one behavioural subtlety is Task 2's trade-off (a malformed key containing `-`/`.` no longer terminates a table); `SerializationRule` still rejects such records, so only the diagnostic degrades — noted in the code comment.
