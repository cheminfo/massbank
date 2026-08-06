# PR #14 — multi-angle review findings (2026-07-27)

Five independent reviewers over `feat/validator-accuracy` (`b0e8219..ee006ed`). All five
returned **APPROVE WITH FINDINGS**; none found anything Critical.

| Angle                               | Verdict                             |
| ----------------------------------- | ----------------------------------- |
| Correctness / regression risk       | APPROVE WITH FINDINGS               |
| Java-oracle & format fidelity       | APPROVE WITH FINDINGS (1 Important) |
| Test design / verification adequacy | APPROVE WITH FINDINGS               |
| API, semver, packaging, docs        | APPROVE WITH FINDINGS               |
| Adversarial input / consumer impact | APPROVE WITH FINDINGS               |

## What was proven

The fix's core claim was confirmed on three independent input distributions:

| Evidence                                              | Result                              |
| ----------------------------------------------------- | ----------------------------------- |
| 13,918 targeted injections at table boundaries        | 0 pass→fail, 679 fail→pass          |
| 45,000 randomized grammar-generated records (3 seeds) | 0 pass→fail, 59 fail→pass           |
| 117-record corpus, differential vs Java               | 122/122 green                       |
| 88,741 exhaustive lines, 17-char adversarial alphabet | claims #5 and #6 hold, 0 violations |
| Mutation testing                                      | 9 mutants, 9 killed, 0 survivors    |

Both casing-collapse directions are test-enforced, and the two table parsers are caught
_separately_ — reverting either alone fails the suite.

**The Java oracle independently confirms the record class this PR unblocks is legal
MassBank.** Synthetic records carrying real lipid nomenclature (`[lyso_PC(alkyl-18:0,-)]-`,
`[{16:0}-OH]+`) validate clean on the Java side with zero findings.

**The safety property is structural, not merely measured.** `FIELD_LINE_STRICT` contains a
literal `:` and its character class cannot match one, so `startsNewField(x) ⟹ x.includes(':')`
holds by construction.

## The stronger argument for why values can't truncate tables

The PR's strict-subset proof shows the new code cannot shrink a table _relative to the old
code_. It says nothing about whether tables terminate _correctly_. The argument that actually
closes the question:

`startsNewField` is consulted only on lines inside a peak or annotation table. Every legal row
begins with a numeric m/z at column 0 — enforced in the Java by a two-space indent plus
`number_primitive`, and in the port by `Number.parseFloat(parts[0])` not being NaN. `^[A-Z]`
cannot match a digit. **A value therefore never occupies column 0 and cannot terminate a
table, however exotic.**

Checked and cleared against the grammar: `CH$NAME` (whose Java character class explicitly
includes `:`), `CH$IUPAC`, `CH$LINK` (`PUBCHEM CID:24779324`, `ChemOnt CHEMONTID:0002213`),
`COMMENT`, `AC$INSTRUMENT`, `RECORD_TITLE` (`…; RT: 42.15`), and the `PK$ANNOTATION` header.
All are field lines, never table rows.

---

# Findings

## 1. A correctly-rejected record is now silently accepted — Important

**Input:** a peak row whose third column carries a colon.

```
  200.0 2.0 500:3
```

|                      | verdict                                                   |
| -------------------- | --------------------------------------------------------- |
| Java                 | **INVALID** — `// expected`                               |
| port, before this PR | INVALID (round-trip failure — right answer, wrong reason) |
| port, after this PR  | **`success: true`, 0 errors, 0 warnings**                 |

**Root cause, and it is not `startsNewField`** — that correctly returns `false` here.
`parsePeakLine` splits on whitespace and calls `Number.parseFloat("500:3")`, which returns
`500`: `parseFloat` stops at the colon and never yields `NaN`, so the guard at
`table-parsers.ts:87` never fires. The row is kept as a valid peak.

**Why nothing downstream catches it.** `SerializationRule` is the stated backstop for exactly
this class of defect, and it is **blind here by construction**: `_original.relativeIntensity`
preserves the literal `"500:3"`, so the round trip re-emits the malformed text byte-for-byte
and compares equal.

The Java's rule, reconstructed from the grammar: the third column must be a bare unsigned
integer terminated immediately by end-of-line. `uint_primitive` consumes `500`, the grammar
demands a newline, finds `:3`, the row fails, the possessive `.plus()` ends the table, and the
parser then expects the `//` endtag.

**Scope.** The lenient `parseFloat` and the `_original` round-trip shield both **predate** this
branch — the old `includes(':')` break was masking this subset by ending the table at that row.
So the PR does not create the hole; it removes an accidental mask. But it does flip this input
class from correctly-rejected to silently accepted, which contradicts the PR's headline claim.

**Fix (not in this PR):** validate the numeric columns — require the third to match `/^\d+$/`
and the first two to consume fully — rather than trusting `parseFloat`'s prefix behaviour.

## 2. `Unrecognized field` warnings are lost for hyphen/space typos — Minor

`matchFieldKey`'s `?? null` branch skips lines whose key contains a character outside
`[A-Za-z0-9_$]`. Executed, before → after:

| line                                | before | after      |
| ----------------------------------- | ------ | ---------- |
| `MS$FOCUSED-ION: PRECURSOR_M/Z 100` | warns  | **silent** |
| `AC$INSTRUMENT-TYPE: LC-ESI-QTOF`   | warns  | **silent** |
| `RECRD_TITLE : typo`                | warns  | **silent** |
| `AC$MASS SPECTROMETRY: MS_TYPE MS2` | warns  | **silent** |

These are exactly the typos the rule exists to catch, and what's lost is the actionable
`Did you mean 'MS$FOCUSED_ION'?`.

**Why this is Minor and not a fidelity regression:** the Java has **no unrecognized-field
diagnostic at all**. Its grammar is a fixed sequence of literals, so an unknown tag always
surfaces as a positional parse error naming the field it expected. Across all 117 corpus
records the Java never emitted one. `UnrecognizedFieldRule` is a **port-only rule with no
oracle counterpart** — its output cannot be adjudicated against the Java. And in every case
the record is still rejected, because the dropped line cannot round-trip.

Note if fixing: widening `FIELD_LINE_ANY_CASE` is safe for the _rule_ (it does not feed table
termination), but the widened pattern must not be reused for `startsNewField`.

Claim #6 ("byte-identical key extraction") is true and was verified exhaustively — but only
for the branch where the regex matches. It says nothing about the null branch.

## 3. `KEY : value` after a table loses the field — Minor

`PK$NUM_PEAK : 2` (space before colon) immediately after an annotation table is now swallowed
into the table, leaving the field `undefined`. `parse-record.ts:90` trims before matching, so
that spacing _is_ a valid field elsewhere. The Java rejects it too (`:  expected`).

**Not consumer-reachable.** `getVariables` never reads `PK$NUM_PEAK` — it builds x/y from
`PK$PEAK`, which both versions parse identically; output is byte-equivalent. Every
`getVariables` call site is downstream of an accept (`MassSpecIsland.tsx:61`,
`MassSpecDropzone.tsx:332`), the view page renders server-stored content that already passed
the backend gate, and both versions reject this record anyway.

## 4. Harness blind spots — Important for Release B, not for this merge

The differential harness is the gate we intend to lean on when _adding_ rules in Release B.
Four blind spots, all executed:

1. **The count check is one-directional** (`compare.mts:147-156`). It iterates our findings
   and flags `tsCount > javaCount`, never the reverse. Java 3 × `unrecognized-field` vs TS 1 →
   **zero divergences reported**. D-1's own failure mode was silently dropping rows; it was
   caught only because it _also_ tripped `serialization`.
2. **Parse-bail is a blanket per-record kill switch** (`compare.mts:117-125`). A Java parse
   error suppresses _all_ categories across _both_ checks, and `categorize`'s fallback
   (`findings.mts:71`) is `/expected|unexpected|parse/i` — broad enough that many Java messages
   route to `parse`.
3. **`Finding` carries no line or column** (`findings.mts:27-31`). A correct category on the
   wrong line reads as agreement — which is precisely the shape of the D-2 bug.
4. **The chemistry allowlist is direction-blind** (`compare.mts:60-64`). It matches kind +
   category without asserting the Java was the rejecting side. Its regex includes `CH\$IUPAC`
   alone, so a future TS-only false rejection mentioning that field would be silently
   suppressed. Suggest a `javaOnly: true` flag asserting `java.valid === false`.

Related: `known-divergences.mts:41` sets `until: 'Release B (v0.5.0)'`, but `isKnownDivergence`
**never reads `until`** — no date or version check. The only test asserts the entry _exists_,
so when `SubtagRule` lands that test fails and pressures the deleter to remove the test rather
than surfacing an expiry. Suggest reading `version` from `package.json` and failing once it is
≥ 0.5.0 while the entry is still present.

## 5. Architectural divergence from the oracle — Note, matters for Release B

The Java has **no field-line production**. It is a petitparser grammar with 31 hard-coded
case-sensitive tag literals; `ofIgnoringCase` appears **zero** times across 357
`StringParser.of` calls. There was never a character class to port — `field-line.ts` is an
invention, correct here but not a translation.

`tagsep` is `": "` — **colon plus a space** (constant #254, verified byte-exact). Our predicate
requires only the colon, making it strictly wider than the oracle's recognizer. Unreachable in
practice per the column-0 argument above.

**The Java terminates tables by indentation**: the row production is `"  "` (two-space prefix,
constant #275) + numbers + newline, repeated `.plus()` unbounded, ending at the first line that
fails the row grammar. There is no `PK$NUM_PEAK` bound — the count is a later semantic rule.
`table-parsers.ts:50` and `:134` call `.trim()` **first**, discarding exactly that signal, then
reconstruct the boundary from a negative key-shape test.

So the PR fixes the symptom with a better heuristic while leaving the port architecturally
divergent. That is the right call for now — an indent-based rewrite is far larger than a bug
fix — but Release B must not assume parity when writing rules that depend on table boundaries.

Bonus: `multiline_start` is `def`'d but never referenced. MassBank 2.6 as implemented has no
continuation lines.

## 6. `findSimilarField` is a latent DoS — pre-existing, this PR reduces it

`unrecognized-field-rule.ts:130-175`. `levenshteinDistance` allocates a full
`(b.length+1) × (a.length+1)` matrix with `a` attacker-controlled, once per recognized field
(32 of them). A 0.95 MB record that is one long `AAAA…: v` line costs **~2.1 s and ~570 MB
heap** — measured, and identical before and after this branch.

In a browser tab on an uploaded file that is a real DoS. **This PR substantially reduces its
reachability** (100,000 calls → 0 on the colon cases), so it argues for merging. Follow-up: cap
key length before the distance call, or use the two-row O(min(m,n)) variant.

---

# Performance and robustness — all clear

**No ReDoS.** Both predicates are anchored, single-quantifier, no alternation or nesting, with
character classes disjoint from `:`. Measured over 48 runs at 10k / 100k / 1M chars: **max
0.877 ms**, zero rows over 50 ms, ~10× time for 10× input throughout.

**No memory amplification — the branch is dramatically cheaper.** The worst case implied by
"tables can only grow" measured as the opposite:

| 100k rows, 1.72 MB | before    | after       |
| ------------------ | --------- | ----------- |
| `annot-colon`      | 1468.7 ms | **34.9 ms** |
| `peak-colon`       | 1754.0 ms | **45.3 ms** |

Under the old code a colon-bearing row broke the table, fell through to the field parser, and
`UnrecognizedFieldRule` emitted one warning per row — each running 32× full Levenshtein.
100,000 warnings before, 0 after. The narrower predicate _removes_ work.

The one direction that costs more — a single colon row followed by many plain rows — is
`438 ms / 398 MB` versus `410 ms / 314 MB` for a **well-formed record of the same size**. The
branch introduces no new worst case; it makes the pre-existing one reachable by input that used
to fail fast. Amplification is ~30× heap per input byte, a property of `PeakWithOriginal`
present before this branch. Worth knowing: NoBS caps uploads at 10 MB → ≈300 MB heap in a tab.

**Pathological documents, no crash / hang / unbounded memory on either version:** 1M-char
single line, 100k tiny lines, 1M-char keys, U+FF1A fullwidth colon, U+2236 ratio colon, U+0301
combining mark, U+FEFF BOM, NUL in row and key, lone `\r`, `\r\r\n`, 1M-row peak table. Unicode
colon look-alikes are correctly _not_ treated as field separators.

---

# Release and packaging

**Release arithmetic → 0.4.1.** Branch commits are `fix:` ×2, `test:`, `docs:`, `chore:`. The
shared release workflow uses `release-please-action@v5`, `release-type: node`, with no
`bump-minor-pre-major` override. No `feat:`, no `!`, no `BREAKING CHANGE`. **0.5.0 stays
reserved.**

**"No API change" — proven three ways.** Runtime export keys identical to base;
`startsNewField`/`matchFieldKey` absent. Every pre-existing emitted `.d.ts` byte-identical, the
sole delta being the new `lib/parser/field-line.d.ts`. And with the tarball installed,
`massbank/lib/parser/field-line.js` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — `exports` has no
subpaths. **`field-line.ts` is genuinely internal**, so `fix:` is right and nothing is
constrained under semver.

**Merge-method trap.** This repo's `CHANGELOG.md` shows merge commits get **double-counted**:
0.4.0 lists the SPLASH feature twice — once from the merge commit (whose body carries the PR
title) and once from the branch commit; 0.2.1 repeats the pattern. **The PR title is itself a
releasable conventional commit under merge-commit mode.** A `feat:`-worded title would consume
0.5.0 regardless of the branch commits. **Use "Rebase and merge."** (PR #14's title is `fix:`,
so this instance is safe either way.)

Caveat on the stated goal: `main` already contains six merge commits, so rebase-and-merge keeps
history linear _going forward_ — it does not make `main` linear.

**Packaging: 173 files, 265 KB unpacked**, no `__tests__/`, no fixtures, no plan docs, nothing
from the private harness. Mechanism worth naming: `files: ["lib","src"]` alone _would_ ship
`src/__tests__/` — it is the nested `src/.npmignore` that excludes them. Nested ignore files
still apply under a `files` allowlist.

**A packaging measurement trap.** `.npmrc` sets `ignore-scripts=true`, so a local
`npm pack --dry-run` **skips `prepack`** and packs whatever `lib/` is already on disk:

| how measured                  | files                       |
| ----------------------------- | --------------------------- |
| stale `lib/` on disk          | 169                         |
| after an explicit build       | **173**                     |
| clean checkout, default flags | **37, zero `lib/` entries** |

The publish workflow passes `--no-ignore-scripts`, overriding the repo `.npmrc`, so the real
publish rebuilds. Audit with that flag — or build first — or the number is fiction.

---

# Downstream (NoBS Portal)

**The upgrade is not silent.** Both lockfiles pin `massbank@0.4.0`; `^0.4.0` does not move
under `npm ci` or plain `npm install`. Taking 0.4.1 is a deliberate act.

**Impact: none.** All 18 NoBS fixtures produce identical badge and issue count on both
versions (5 valid stay "Valid", 13 invalid keep identical counts). No test assertions at risk —
the two real-library tests use fixtures with no colons in table rows, and the e2e assertions are
count-agnostic. Warnings never gate: both services compute
`blockingErrors = errors.filter(e => e.type !== 'splash')` and check `.length === 0`.

One nuance: `massSpecIssueCount` is `errors.length + warnings.length` and `validityOf` returns
`'warnings'` whenever `warningCount > 0`, flipping the badge from "Valid" to amber "N issues".
So a warning _does_ change displayed state. But a **file showing "Valid" today cannot start
showing issues**, because a new warning requires the record to have previously failed to parse —
and such a record shows invalid/blocked today.

**When bumping: change both lockfiles in the same commit.** A skew where the frontend is 0.4.1
and the backend 0.4.0 is a real user-visible failure — the frontend accepts a colon-bearing
record, the user submits, the backend rejects with `INVALID_MASSBANK_CONTENT` → 400. The two
gates must agree on the same bytes.

---

# PR body corrections required before merge

None affect the code. All were caught by more than one reviewer or verified by execution.

1. **"No new warnings" is strictly false.** A record that previously died at parse can now
   parse and emit warnings. The **README already words this correctly**; the PR body is looser
   than the project's own docs. Adopt claim #2's scoping ("on any record that _previously
   parsed_"), which is accurate.
2. **"Only turns wrongly-rejected records into accepted ones" is false** — see finding 1. At
   least one input class goes from _correctly_-rejected to silently accepted.
3. **Claim #3 misrepresents the five records.** Per the Java, only **UT001074 and UT001280 are
   VALID**. UT000530, UT001178 and UT001394 are INVALID (InChIKey-from-SMILES mismatch) — we
   accept them because we do not implement the CDK chemistry check. Before this PR they
   _accidentally_ agreed with the oracle; after it they are **newly-suppressed divergences**
   held green by the `chemistry` allowlist, which now covers 8 of 117 records.
4. **"169 files" is 173** — see the packaging trap above.

---

# Follow-up backlog

| #   | Item                                                                                                 | Priority                         |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | Validate peak numeric columns; stop trusting `parseFloat` prefix behaviour (finding 1)               | High                             |
| 2   | Harness: add the `javaCount > tsCount` direction                                                     | High — blocks trusting Release B |
| 3   | Harness: narrow parse-bail and the `categorize` fallback                                             | High — same                      |
| 4   | Harness: carry line/column on `Finding`                                                              | Medium                           |
| 5   | Harness: `javaOnly` flag on the chemistry allowlist entry                                            | Medium                           |
| 6   | Make `until` load-bearing — fail once `version >= 0.5.0`                                             | Medium                           |
| 7   | Recover typo warnings by widening `FIELD_LINE_ANY_CASE` only (finding 2)                             | Low                              |
| 8   | Cap key length before `levenshteinDistance` (finding 6)                                              | Low                              |
| 9   | Document the structural grammar (`tagsep`, indent rows, case sensitivity) in the extracted reference | Low                              |

Pre-existing issues confirmed but out of scope: the README's `{ACCESSION}.txt` filename claim
is false (`AccessionMatchRule` strips any extension); `filesProcessed` is documented as always
1 but returns 0 on read failure; the `legacy` option is threaded to every rule and read by
none; `types.ts` declares a `'duplicate'` error type nothing emits.
