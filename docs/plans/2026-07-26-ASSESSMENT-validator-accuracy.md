# Assessment — `massbank` validator accuracy & readiness for v0.5.0

Research output, 2026-07-26. Input to the implementation plan. No code changes are
described here as "done" — everything below is a _finding_, to be fixed under TDD.

## Why this exists

The NoBS Portal needs an in-browser MassBank record **builder** (construct a record
field-by-field, validate gaps, emit a valid `.txt`). Building that on top of the
package surfaced two questions that had to be answered before any design work:

1. Is our TypeScript port _accurate_ — does it agree with the original Java validator?
2. What is actually missing for a builder, as opposed to a file validator?

Both are now answered empirically rather than by reading the spec.

---

## 1. Provenance resolved (was blocker OQ-8)

The local checkout was 5 commits behind at v0.3.0 while both NoBS apps consumed v0.4.0
from npm, so it was unclear whether the checkout was canonical. It is: `git pull
--ff-only` fast-forwarded cleanly to **v0.4.0** with no local commits. This repo is the
canonical `cheminfo/massbank`. **P-PKG is unblocked.**

## 2. The Java oracle is runnable locally

The behavioural source of truth (repo CLAUDE.md) is the Java, but only
`massbank/cli/Validator.java` is vendored — the grammar lives in the `massbank-lib`
Maven artifact. There is no Maven and no `target/` build on this machine, yet the
oracle _can_ be run:

- All dependencies (incl. CDK) are already cached in `~/.m2`; a classpath assembled by
  globbing that tree works.
- **`slf4j-api 1.7.36` must be excluded.** It shadows 2.0.17, SLF4J then fails to bind
  to `log4j-slf4j2-impl`, silently falls back to a NOP logger, and _every finding is
  discarded_ — the validator appears to pass everything. This cost real debugging time
  and must stay documented.
- An explicit log4j2 config is required for the same reason.
- Exit code is the verdict: `0` = valid, `1` = rejected.

`massbank-lib` ships two vocabularies as jar resources (`recordformat/license.ini`,
`recordformat/ch_link.ini`); the rest are string constants recoverable via
`javap -v -p massbank/RecordParserDefinition.class`. Extracted verbatim into
`docs/plans/EXTRACTED-java-grammar-cv-reference.md`.

## 3. Measured baseline (two-sided, 300 official records)

Corpus: stratified sample across 11 contributors from `MassBank/MassBank-data`
(Athens_Univ, Eawag, RIKEN, Fiocruz, Chubu_Univ, LCSB, Waters, MSSJ, Keio_Univ,
BGC_Munich, UFZ). Harness: `Test/differential/`.

| Divergence                       | Count | Meaning                                        |
| -------------------------------- | ----: | ---------------------------------------------- |
| `missing-in-ts:free-subtag`      |   169 | we have **no** subtag vocabulary at all        |
| `verdict`                        |    29 | mostly CDK chemistry (deliberately not ported) |
| `extra-in-ts:serialization`      |    20 | **we reject records Java accepts**             |
| `extra-in-ts:unrecognized-field` |    19 | bogus warnings on valid records                |

Against the pre-existing local corpus (112 real downloaded records): **0 fail our
validator**, 5 fail Java (CDK InChIKey cross-check). So the port is not broadly broken —
it has specific, findable defects.

## 4. Confirmed defects (each with a reproducible case)

### D-1 — table parsers terminate on any colon (HIGH; false rejection of valid records)

`PeakTableParser` and `AnnotationTableParser` end the table at
`if (line.includes(':')) break;`. Annotation values legitimately contain colons — lipid
nomenclature is pervasive in metabolomics. In
`MSBNK-Chubu_Univ-UT001074` the row

```
  494.35 1 [lyso_PC(alkyl-18:0,-)]- 494.3610499491 -21 C25H53NO6P-
```

ends the table early. The remaining rows fall through to the field parser, the
annotations are lost from the record, and `SerializationRule` then fails the round trip.
Net effect: **an officially published record is reported invalid.** This is the direct
cause of the 20 `extra-in-ts:serialization` divergences.

Correct termination is "the next record field", i.e. a key-shaped token followed by a
colon — not any colon.

### D-2 — `UnrecognizedFieldRule` has the same colon assumption (MEDIUM; false warnings)

It independently rescans the raw text using `line.indexOf(':')` and treats everything
before the first colon as a field key, producing
`Unrecognized field '494.35 1 [lyso_PC(alkyl-18'`. Must match a key shape instead.
Note its `findSimilarField(key.toUpperCase())` shows it deliberately wants to catch
_mis-cased_ keys, so the key pattern must stay case-insensitive at the first letter or
that capability is lost.

### D-3 — no subtag vocabulary (MEDIUM; 169 missed warnings)

Java warns `Usage of free subtag "X" in AC$MASS_SPECTROMETRY is not recomended.` (sic).
We emit nothing. Requires the AC$MASS_SPECTROMETRY (59) and AC$CHROMATOGRAPHY (25)
recommended lists. Note the closed/open distinction: `MS$FOCUSED_ION` (9) and
`MS$DATA_PROCESSING` (12) have **no** free-subtag fallback in Java — an unknown subtag
there is a hard parse failure.

### D-4 — no mandatory-field, ordering, or CV enforcement (HIGH for the builder)

The only requiredness check in the whole TS tree is `ACCESSION` in `parse-record.ts`.
`InternalRecord` marks every other field optional. There are zero controlled
vocabularies. Java requires **16 fields in a fixed order** (it is a sequence parser, so
order is itself mandatory) and enforces LICENSE / MS_TYPE / ION_MODE / CH$LINK /
INSTRUMENT_TYPE / PRECURSOR_TYPE grammars. This is why our parser accepts records the
Java rejects (13 `missing-in-ts:parse`).

## 5. Deliberate divergences — do NOT "fix" these

### K-1 — `\r` in the non-standard-character set (Java bug, ours is right)

Java's allow-list `[\w\n\-\[\]."\\ ;:–=+,|(){}/$%@'°!?#`^*&<>µáćÉéóäöü©]+`includes`\n`but **omits`\r`\*\*, so it warns "Non standard ASCII character found" on *every\*
CRLF-terminated record — 107 of our 125 local samples, 112 of which are CRLF. Our port
includes `\r` and is silent. Mirroring Java here would add a false positive to nearly
every real-world record. **Keep our behaviour; the harness must whitelist this
divergence** or it drowns the report.

Genuine non-standard characters in the corpus (excluding `\r`): only `—` (U+2014) and
`•` (U+2022), and only in hand-written fixtures.

### K-2 — CDK chemistry checks

SMILES parsing, InChI generation, formula round-trip and the three InChIKey
cross-checks require a chemistry toolkit and are intentionally out of scope. The
harness already classifies these as `expected-chemistry-gap`. The `N/A`-sentinel guards
around them are pure string logic and _are_ portable.

### K-3 — `FRAGMENTATION_MODE`

Its vocabulary is commented out upstream (`//TODO properly integrate CV terms`), so real
records using it get "not recomended" from Java. Our `cv.ts` in NoBS treats it as a
closed CV — an invention. Mirror the Java: free subtag, advisory only.

## 6. Corrections this forces on the NoBS-side design

Our app-side `cv.ts` / `mandatoryFieldRule.ts` were written from the spec by hand and
have drifted from the authority:

- `LICENSE` is missing `CC BY-NC-ND` and `dl-de/by-2-0` → **valid licences rejected**.
- Ionisation tokens: Java has `SI`, we wrote `SIMS`; we invented `DART`, `ESSI`, `LD`.
- `INLET_TYPE` **does not exist** anywhere in the Java grammar; we invented 13 members.
- `CH$COMPOUND_CLASS` is **optional** in Java; we gated export on it.
- There is **no** "MS2 requires a precursor" rule — `MS$FOCUSED_ION` is unconditionally
  optional. Our conditional gate is an invention and must be a warning at most.
- `PRECURSOR_TYPE` is a generative adduct _grammar_ (and forbids writing charge `1+`);
  `ION_TYPE` is the closed ~50-member list. We conflated them.
- `ACCESSION` requires **three** segments (`/^\w{1,10}-\w{1,32}-[A-Z0-9_]{1,64}$/`), so
  the planned `NOBSDEV-<date>` placeholder would itself be invalid.
- Peaks must be **strictly** ascending (duplicate m/z rejected); annotation sorting is
  non-strict. Our `peaksToPkPeak` neither sorts nor dedupes.
- `PK$NUM_PEAK` must always be emitted as `peaks.length` — Java's own consistency check
  is dead code, but the round trip catches a wrong value.

## 7. What a builder additionally needs from the package

- **Exports.** `serializeRecord`, `parseRecord`, `InternalRecord`, `RecordValidator`,
  `IValidationRule` all exist but are unreachable: `src/index.ts` does not re-export
  them and `package.json` maps only `"."`. Purely additive fix.
- **`buildRecord(partial)`** — normalise, derive `PK$NUM_PEAK`/`PK$SPLASH`, sort peaks,
  and guarantee the result is serializer-idempotent.
- **`validateRecord(record)`** — a structured-stage entry point. `validateContent`
  requires text, and 3 of the 5 existing rules take `originalText` as their real input,
  so they cannot run on a constructed record. `SerializationRule` is meaningless for one
  and must be skipped rather than adapted.
- Unknown-field preservation, if zero-metadata-loss is to hold through a round trip
  (the parser currently drops unrecognised keys at `default: break`).

## 8. Open questions for the plan

- **OQ-A** Does the MGF import module move into the package (adds an `mgf-parser`
  dependency to a MassBank-format library), or stay app-side? Owner: user.
- **OQ-B** Should mandatory-field/order enforcement be a _blocking_ rule, or opt-in via
  options? Enabling it by default changes the verdict for records we currently accept —
  a breaking change for consumers. Owner: user/Luc.
- **OQ-C** How much of the closed CV enforcement belongs in 0.5.0 versus later?

## 9. How to reproduce

```bash
# two-sided report over the bundled corpus
cd Test && npx tsx differential/report.mts

# against any directory of records
npx tsx differential/report.mts /path/to/records
```

Exits non-zero when any non-chemistry divergence remains, so it can gate CI.
