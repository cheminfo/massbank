# Header-driven `PK$ANNOTATION` parsing (0.5.1)

Follows 0.5.0 (the builder API, PR #16). Not a bug report — we own this repo; this is the
sequencing note for work we are choosing to do next.

## The defect

`parseAnnotationLine` (`src/parser/table-parsers.ts`) decides what each token in an annotation
row means by **counting tokens**, and in the three-token case by guessing whether a token parses
as a number. It does this despite `AnnotationTableParser` having already captured the
`PK$ANNOTATION` header that names the columns. The comment above the branch even says _"The
header tells us the format, so we parse accordingly"_ — and then it doesn't.

Measured consequences:

- A row with **five or more columns** is read as `[mz, annotation]`; columns 3+ survive only
  inside `_original`. Every annotated record in the 112-record corpus is five columns.
- A **three-column row with a non-numeric third token** loses that token the same way — the real
  shape `494.35 1 [lyso_PC(alkyl-18:0,-)]-`.
- A **numeric-looking annotation** is misread: `100.25 5-methyl 194.08` parses as
  `{exactMass: 5, errorPpm: 194.08}` with the annotation gone, because `parseFloat('5-methyl')`
  is `5`.

None of this is visible through `parseRecord` → `serializeRecord`, because the serializer prefers
`_original` and reprints the source line verbatim. It only surfaces the moment anything rebuilds a
row from typed fields — which is what the 0.5.0 builder does.

## Why it is worth doing, beyond correctness

Fixing the parser lets us **delete** most of what 0.5.0 had to build around it:

| Exists only because the parser drops columns                                                                                                                           | Location                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `checkAnnotationDiscardedColumns` and its two branches                                                                                                                 | `src/builder/build-record.ts` |
| The whole `_original` preservation mechanism — `reparseAnnotationOriginal`, `wasAnnotationRowEdited`, the all-or-nothing table rule, the `_PK$ANNOTATION_HEADER` guard | same                          |
| The `looksNumeric` / `parseFloat` coupling and its regression lock                                                                                                     | same                          |
| `ANNOTATION_DISCARDED_COLUMN`, `ANNOTATION_ORIGINAL_LINE_INJECTION`, `ANNOTATION_ORIGINAL_UNREADABLE`                                                                  | `src/builder/exceptions.ts`   |

That is several hundred lines of guard, comment and test, and it is the part of 0.5.0 that took
five review rounds to get right. A header-driven parser makes the builder simpler, not just more
correct — `buildRecord` could rebuild every row from typed fields with no preservation machinery
at all.

## The decision that has to come first

Headers are free-form in practice. The corpus is uniform, which is a gift for designing against
real data and a trap for assuming it is the whole world:

```
50 of 50 annotated corpus records:  m/z tentative_formula formula_count mass error(ppm)
also seen in the repo's fixtures:   m/z ion
                                    m/z annotation exact_mass error(ppm)
                                    m/z num type
```

So the work needs a column-name vocabulary: which header tokens map to `annotation`, `exactMass`,
`errorPpm`, and what to do with columns that map to nothing (`tentative_formula`,
`formula_count`). That is the same controlled-vocabulary problem the library defers elsewhere,
and it is the reason this is its own piece of work rather than a patch.

Open questions to settle before implementing:

1. **Unmapped columns.** `formula_count` has no typed field. Extend `Annotation` with the extra
   columns, keep a typed side-channel, or accept the loss and say so? This decides whether the
   builder can drop `_original` entirely or only mostly.
2. **Unknown headers.** A header we do not recognise — fall back to today's token-count
   behaviour, or refuse? Falling back keeps every existing record parsing; refusing is honest but
   breaks unknown-in-the-wild data.
3. **Case and punctuation.** `error(ppm)` vs `error_ppm` vs `ppm`. Normalise, or match literally?

## Semver

Labelled 0.5.1 for tracking, but the real bump depends on what lands:

- Parser-only fix, `fix:` → **0.5.1**. Note this still changes `parseRecord`'s output for existing
  records, which is a behavioural change even though release-please classes it a patch.
- If it also relaxes builder guards — `buildRecord` starting to accept edited five-column tables
  it currently refuses — that is new capability, `feat:` → **0.6.0**.

Decide which before cutting the release, and say so in the release notes the way 0.5.0 has to
state its own scope.

## Verification the work must carry

The 0.5.0 review found that reasoning about this format is unreliable and measurement is not.
Whatever replaces the token-count branches must be proven the same way:

- **A corpus differential.** All 112 records at `MassBank_P/samples/` parse, and every annotation
  row's typed fields are compared before and after. Any change is either an intended fix or a
  regression — no silent diffs.
- **The two existing property sweeps must still pass**, or be deleted with an argument. Sweep 2
  (63 column patterns) is written against the current parser's branches; a header-driven parser
  changes what "lossless" means, so the sweep's oracle changes with it.
- **A new sweep over headers × row shapes**, asserting that a row parsed under its own header
  reparses to itself.
- Guards deleted from the builder must be deleted _because a test proves they can no longer
  fire_, not because they look unnecessary.

## Out of scope

- Peak-table column handling. `parsePeakLine` reads three tokens and ignores the rest, but
  `PK$PEAK` has a fixed three-column format, so there is nothing to recover.
- The controlled-vocabulary work for `AC$`/`CH$` fields. Different problem, different release.
