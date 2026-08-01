# massbank

[![NPM version](https://img.shields.io/npm/v/massbank.svg)](https://www.npmjs.com/package/massbank)
[![npm download](https://img.shields.io/npm/dm/massbank.svg)](https://www.npmjs.com/package/massbank)
[![test coverage](https://img.shields.io/codecov/c/github/cheminfo/massbank.svg)](https://codecov.io/gh/cheminfo/massbank)
[![license](https://img.shields.io/npm/l/massbank.svg)](https://github.com/cheminfo/massbank/blob/main/LICENSE)

A TypeScript/JavaScript library for validating MassBank record files. This library provides validation for MassBank format 2.6.0, ensuring compliance with MassBank standards for automated submission to the MassBank-data repository.

## Installation

```console
npm install massbank
```

## Usage

### Basic File Validation

```typescript
import { validate } from 'massbank';

// Validate a single file
const result = await validate('path/to/MSBNK-test-TST00001.txt');

if (result.success) {
  console.log('Validation passed!');
  console.log('Accession:', result.accessions[0]);
} else {
  console.error('❌ Validation failed:');
  result.errors.forEach((error) => {
    console.error(`  Line ${error.line}: ${error.message}`);
  });
}
```

### In-Memory Validation

```typescript
import { validateContent } from 'massbank';

// Validate record text without file I/O
const recordText = `ACCESSION: MSBNK-test-TST00001
RECORD_TITLE: Test Record
//`;

const result = await validateContent(recordText, 'MSBNK-test-TST00001.txt');
```

### With Options

```typescript
import { validate } from 'massbank';
import { FifoLogger } from 'fifo-logger';

const logger = new FifoLogger({ level: 'info' });

const result = await validate('record.txt', {
  legacy: true, // Enable legacy mode for less strict validation
  logger: logger, // Optional logger for validation messages
});
```

### Building a Record

```typescript
import { buildRecord, validateRecord } from 'massbank';

const record = await buildRecord({
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

// record.PK$PEAK is now sorted ascending by m/z; PK$NUM_PEAK and PK$SPLASH
// are derived from the sorted peaks, not trusted from the draft.

const result = await validateRecord(record);
```

See [Builder API](#builder-api) below for what a green result does NOT mean.

## Validation Rules

The validator performs the following checks:

1. **Parse Validation** - Ensures the record can be parsed correctly according to MassBank format 2.6.0
2. **ACCESSION Matching** - Validates that ACCESSION field matches the filename (CRITICAL for MassBank-data repository)
   - Example: File `MSBNK-test-TST00001.txt` must contain `ACCESSION: MSBNK-test-TST00001`
3. **Unrecognized Fields** - Warns about unrecognized field names (helps catch typos like `RECRD_TITLE` instead of `RECORD_TITLE`)
4. **Non-Standard Characters** - Warns about non-standard ASCII characters (non-blocking)
5. **Serialization Round-Trip** - Ensures parse → serialize → compare matches exactly (guarantees no data loss)
6. **SPLASH Verification** - Recomputes the peak-list SPLASH hash locally (offline, no network call) and compares it to the declared `PK$SPLASH`; a mismatch is a blocking error. Skipped when a record has no `PK$SPLASH`, has no peaks, or has a peak list that can't be hashed (degenerate/unhashable peak data — such a record is still caught by the serialization round-trip check).

Records whose annotation values contain a colon — lipid nomenclature such as `[lyso_PC(alkyl-18:0,-)]-`, common in metabolomics MassBank data — now parse and round-trip correctly instead of being wrongly rejected. Because warnings are only computed after a successful parse, a record that previously failed to parse may now surface warnings it never had the chance to emit before.

## Builder API

`buildRecord` and `validateRecord` let you construct and check records programmatically instead of hand-rolling MassBank format text.

`buildRecord(draft: RecordDraft)` normalizes a draft into a canonical `MassBankRecord`. Only `ACCESSION` is required. It:

- Sorts both `PK$PEAK` and `PK$ANNOTATION` ascending by `mz`. Peaks keep their own `intensity` and `relativeIntensity` attached; annotation rows keep their own `annotation`/`exactMass`/`errorPpm` attached. A caller supplying either table in a deliberate order gets it silently reordered.
- Derives `PK$NUM_PEAK` from the sorted peak count — a draft-supplied value is discarded.
- Recomputes `PK$SPLASH` from the sorted peaks — a stale declared value is discarded, because a wrong SPLASH breaks cross-database matching silently, which is worse than a missing one.
- **Always strips `_original` from peaks**, so the serializer can't fall back to stale round-trip text under a freshly recomputed `PK$SPLASH` — a peak's `_original` feeds that hash, so printing it verbatim could disagree with it.
- **Peaks have the same discarded-column hazard as `PK$ANNOTATION` (see below), but no guard against it.** The peak parser only reads the first three tokens (`mz`, `intensity`, `relativeIntensity`); a fourth token on a source row is silently dropped at parse time, and a non-numeric third token becomes `relativeIntensity: 0` with its real text surviving only in `_original.relativeIntensity`. A source row `100 999 abc` parses to `relativeIntensity: 0` with `_original.relativeIntensity: "abc"` — plain `serializeRecord` reprints `abc` byte-exactly, but `buildRecord` reprints `0`, because the bullet above always strips a peak's `_original`. Unlike `PK$ANNOTATION`, this cannot be fixed by preserving `_original` instead — a peak's `_original` feeds `PK$SPLASH`, so keeping it around risks the same staleness the strip above exists to prevent. This is a documentation note, not a guard: nothing currently rejects it.
- **Keeps `_original` on annotation rows (and the table's `_PK$ANNOTATION_HEADER`) when the whole table round-trips unedited**, and discards both, table-wide, the moment any row's fields diverge from what its own `_original` reparses to. An annotation row never feeds `PK$SPLASH`, so — unlike peaks — there is no staleness risk in printing an unedited row's real source text verbatim, column count and all. This is what lets `buildRecord(parseRecord(file))` round-trip a real MassBank PK$ANNOTATION table with more than 4 columns (see the next bullet) instead of rejecting it outright. Editing even one row falls back to rebuilding every row from typed fields under a fresh canonical header (`m/z annotation exact_mass error(ppm)`), since a parsed source's custom header (e.g. `m/z tentative_formula formula_count mass error(ppm)`) no longer describes rebuilt rows.
- Drops an empty `PK$PEAK` or `PK$ANNOTATION` table, keeping the returned object's shape consistent with the `PK$NUM_PEAK`/`PK$SPLASH` deletes below rather than carrying an empty array. An empty peak list is **dropped, not hashed** — it never reaches the SPLASH computation and never throws.
- Drops `PK$NUM_PEAK` and `PK$SPLASH` when there are no peaks, so a stale count or hash can't survive a peakless draft.
- **Preserves duplicate `mz` values deliberately.** A duplicate can be a real instrument artifact; dropping the row loses data, and summing it invents a reading that was never measured.
- **Rejects `PK$ANNOTATION` rows the format cannot express.** `PK$ANNOTATION` is read back by token count, not by a fixed field order, so the legal combinations of `annotation`/`exactMass`/`errorPpm` are not simply "a prefix": `{}`, `{annotation}` (any text), `{exactMass, errorPpm}`, `{annotation, exactMass}` (only when `annotation` doesn't parse as a leading number — see below), and the full `{annotation, exactMass, errorPpm}` all round-trip; `exactMass` or `errorPpm` alone, and `{annotation, errorPpm}` without `exactMass`, do not. `annotation` must also be non-empty with no whitespace, and `mz`, `exactMass`, and `errorPpm` must all be finite. The check is `Number.parseFloat`-based, not "looks like text vs. looks like a number": a numeric-leading name such as `2-hydroxybenzoate` is rejected in this shape, common as that is in metabolomics nomenclature. See the throwing/legal combinations below.
- **Rejects an edited row parsed from a real PK$ANNOTATION table whose source columns the parser did not fully map into typed fields.** The parser's token-count branches are positional but not all of them account for every token: a 3-column row is only fully captured when its third column looks numeric (otherwise the parser reads `[mz, annotation]` and drops the third column — a real shape in lipid nomenclature, e.g. `"494.35 1 [lyso_PC(alkyl-18:0,-)]-"`), and a row of 5 or more columns is always read as `[mz, annotation]` only. An **unedited** row like this builds successfully — it prints as its own source text, columns and all, per the bullet above. Only once a row has been edited does rebuilding from the parsed fields become necessary, and only then would it silently drop the uncaptured column(s); this only applies to rows carrying that raw source text — a caller building a draft by hand cannot trigger it.
- **Rejects a non-finite or negative `relativeIntensity`.** `relativeIntensity` never reaches the SPLASH computation, so it is the one numeric peak field that would otherwise pass through unchecked. `relativeIntensity` is caller-owned: `buildRecord` validates it but never computes or rescales it. The MassBank convention is intensity scaled against the base peak (commonly to 999 or to 100), but the format does not fix which scale a given record uses, and deriving it on a `buildRecord(parseRecord(file))` round trip would silently rescale a value that was already correct in the source.
- **Rejects an `ACCESSION` that could not be read back.** This covers a newline or carriage return (`ACCESSION` is written as the record's first line verbatim, so either would inject the following text as forged header lines once serialized), being empty or whitespace-only (parseRecord treats an empty `ACCESSION` as missing and throws on reparse), and leading or trailing whitespace (trimmed away on reparse, so the reparsed value would differ from the one supplied).
- **Rejects a newline in any other field the serializer writes verbatim** — a single-value field on its own line, or an element of an array-valued field (`COMMENT`, `CH$NAME`, `CH$LINK`, `AC$MASS_SPECTROMETRY`, `AC$CHROMATOGRAPHY`, `MS$FOCUSED_ION`, `MS$DATA_PROCESSING`, `SP$LINK`, and the rest of the single-value header/CH$/AC$/SP$ fields). A newline would inject the text that follows it as forged lines once the record is reparsed. A bare carriage return with no newline is not rejected: `parseRecord` only starts a new line on `\n`, so such a value round-trips unchanged.
- Never mutates the draft passed in, but the returned record **shares array references** with it for every array-valued field it doesn't rebuild (e.g. `CH$NAME`, `COMMENT`, `AC$MASS_SPECTROMETRY`) — those are copied by reference, not deep-cloned. Mutating one of those arrays on the returned record mutates the same array on the original draft. `PK$PEAK` and `PK$ANNOTATION` are the exception: they're always rebuilt into fresh arrays.

```typescript
// Duplicate m/z survive intact.
await buildRecord({
  ACCESSION: 'MSBNK-test-TST00001',
  PK$PEAK: [
    { mz: 100.25, intensity: 100, relativeIntensity: 999 },
    { mz: 100.25, intensity: 50, relativeIntensity: 500 },
  ],
});

// { exactMass, errorPpm } without annotation round-trips fine — the parser
// has a dedicated 3-token recovery for "both remaining tokens are numeric".
await buildRecord({
  ACCESSION: 'MSBNK-test-TST00001',
  PK$ANNOTATION: [{ mz: 100.25, exactMass: 194.0804, errorPpm: 1.2 }],
});

// exactMass alone (no annotation, no errorPpm) does NOT round-trip: the
// parser reads a 2-token row as [mz, annotation] unconditionally, so this
// value would come back as annotation text, not exactMass.
try {
  await buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    PK$ANNOTATION: [{ mz: 100.25, exactMass: 194.0804 }],
  });
} catch (error) {
  // BuildException: PK$ANNOTATION[0]: PK$ANNOTATION row 0 (mz 100.25): exactMass is set without annotation or errorPpm. ...
}

// A negative mz is rejected outright: it isn't a real peak position, and
// calculateSplash's histogram binning would otherwise alias it onto the same
// bin as a small non-negative mz instead of catching it.
try {
  await buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    PK$PEAK: [{ mz: -50, intensity: 100, relativeIntensity: 999 }],
  });
} catch (error) {
  // BuildException: PK$PEAK[0].mz: PK$PEAK row 0 (mz -50): mz is negative. ...
}

// An all-zero, negative-intensity, or non-finite spectrum can't be hashed, so
// buildRecord throws instead of silently producing a record with no
// PK$SPLASH. This is a plain RangeError from calculateSplash itself, raised
// separately from BuildException because it can only be detected once every
// BuildException guard above has already passed.
try {
  await buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    PK$PEAK: [{ mz: 100.25, intensity: 0, relativeIntensity: 0 }],
  });
} catch (error) {
  // RangeError: Cannot calculate SPLASH for an all-zero-intensity spectrum.
}
```

`validateRecord(record: MassBankRecord, options?: ValidationOptions)` validates a structured record by serializing it and delegating to `validateContent`, so the same bytes get the same verdict through either entry point.

Two limits are worth knowing:

1. **The filename is derived from `ACCESSION`** (as `` `${record.ACCESSION}.txt` ``), because a `MassBankRecord` carries no filename of its own. `AccessionMatchRule` therefore **cannot fail** on this path for an `ACCESSION` with no path separator — a green result is not evidence the accession matches any external filename. An `ACCESSION` containing a path separator (e.g. `foo/bar` or `foo\bar`) still trips the rule against a basename it never saw — a confusing error, not a false pass. Use `validate()` or `validateContent()` with the real filename to check that.
2. **Mandatory fields and controlled vocabularies are not checked**, same as `validate`/`validateContent` today (see [MassBank Format 2.6.0 Compliance](#massbank-format-260-compliance)). A record containing only `ACCESSION` returns `success: true`. A green result means "round-trips and passes the current rule set," not "submittable to MassBank."

### Additional exports

This package also exports, from the package root:

- `parseRecord` and `serializeRecord` — the parser and serializer `buildRecord`/`validateRecord` are built on
- `ParseException` — the error `parseRecord` throws on malformed input
- Types: `Annotation`, `MassBankRecord`, `ParseError`, `Peak`, and `RecordDraft`

Three things to keep straight when working with these directly:

- **`Peak` and `SplashPeak` are different shapes.** `Peak` (used by records and the builder) is `{ mz, intensity, relativeIntensity }`. `SplashPeak` (used by the `splash` module, also exported from the root) is `{ mz, intensity }` — the SPLASH algorithm never reads `relativeIntensity`. A `Peak` satisfies `SplashPeak` structurally, but they are declared separately — don't assume one is the other.
- **`resolveSplashFromRecord` takes record _text_; `validateRecord` takes a record _object_.** `resolveSplashFromRecord(content)` parses the text itself to reconcile `PK$SPLASH` against the peaks. `validateRecord(record, options?)` takes an already-structured record and serializes it before validating. The two aren't interchangeable — passing text to `validateRecord`, or a record object to `resolveSplashFromRecord`, is a type error.
- **`parseRecord` throws `ParseException`, not a plain `Error`.** It carries a structured `parseError: ParseError` with `line`, `column`, `position`, and `message`, so a caller can `instanceof ParseException` and read the failure location instead of string-matching the message.

## API Reference

### `validate(filePath, options?)`

Validate a single MassBank record file.

**Parameters:**

- `filePath: string` - Path to the .txt file to validate
- `options?: ValidationOptions` - Optional validation options

**Returns:** `Promise<ValidationResult>`

**ValidationResult:**

```typescript
interface ValidationResult {
  success: boolean; // true if no errors
  errors: ValidationError[]; // Array of validation errors
  warnings: ValidationWarning[]; // Array of warnings (non-blocking)
  accessions: string[]; // Extracted ACCESSION values
  filesProcessed: number; // Number of files processed (always 1)
}
```

### `validateContent(text, filename, options?)`

Validate in-memory MassBank record content (no file I/O).

**Parameters:**

- `text: string` - The MassBank record text
- `filename: string` - Logical filename for error reporting (e.g., 'user-upload.txt')
- `options?: ValidationOptions` - Optional validation options

**Returns:** `Promise<ValidationResult>`

### `buildRecord(draft)`

Normalize a record draft into a canonical record. See [Builder API](#builder-api) above for what it normalizes and why.

**Parameters:**

- `draft: RecordDraft` - A partial `MassBankRecord` requiring only `ACCESSION`; `PK$PEAK`/`PK$ANNOTATION` accept the caller-facing `Peak`/`Annotation` shapes (no `_original`)

**Returns:** `Promise<MassBankRecord>`

**Throws:** `BuildException` if `ACCESSION` contains a newline or carriage return, is empty or whitespace-only, or has leading or trailing whitespace; if any other field the serializer writes verbatim (or an element of an array-valued one) is empty, whitespace-padded, or contains a newline or carriage return; if a peak's `relativeIntensity` is not finite or is negative, or a peak's `mz` is negative; or if a `PK$ANNOTATION` row cannot survive a round-trip (including an _edited_ parsed row whose source columns the parser did not fully map into typed fields — an unedited one builds successfully instead, preserving its real source text) — `error.buildErrors` carries every failure found, not only the first; see [Builder API](#builder-api) above for the full legal/illegal combinations. Separately, **`RangeError`** if a non-empty `PK$PEAK` passes every guard above but still cannot be hashed (all-zero intensity, a negative intensity, or a non-finite `mz`/`intensity`) — thrown by `calculateSplash` itself, after every `BuildException` guard has already passed, so it is never part of `error.buildErrors`.

### `validateRecord(record, options?)`

Validate a structured record. See [Builder API](#builder-api) above for the two limits this entry point has.

**Parameters:**

- `record: MassBankRecord` - The structured record to validate
- `options?: ValidationOptions` - Optional validation options, forwarded to `validateContent`

**Returns:** `Promise<ValidationResult>` (same shape as `validate`/`validateContent`)

## MassBank Format 2.6.0 Compliance

This library enforces MassBank format 2.6.0 standards, including:

- **ACCESSION format:** `MSBNK-[ContributorID]-[RecordID]`
  - Contributor ID: up to 32 characters (letters, digits, underscore)
  - Record ID: up to 64 characters (capital letters, digits, underscore)
  - Shown for reference; this structure is not itself validated — only that ACCESSION matches the filename (see Validation Rules above)
- **Filename matching:** File must be named `{ACCESSION}.txt`
- **Required fields:** ACCESSION (parsing fails without it); RECORD_TITLE, DATE, AUTHORS, LICENSE, and other format fields are not currently enforced as mandatory by this library — `validateRecord` (see [Builder API](#builder-api)) shares this limit
- **SPLASH validation:** Local, offline recomputation of the peak-list SPLASH hash, compared against the declared `PK$SPLASH` (no network call)

## Requirements

- Node.js 20+ (see `engines` in `package.json`)
- Runtime dependencies: `camelcase`, `cheminfo-types`, `ensure-string`, `fifo-logger`. `cheminfo-types` and `fifo-logger` are only ever imported as types (`ValidationOptions.logger` and a few others) — no runtime code from either ships in `lib/` — but they are listed as `dependencies` rather than `devDependencies` because they appear in the package's shipped `.d.ts` files, so a consumer's own type-check needs them resolvable too.

## License

[MIT](./LICENSE)
