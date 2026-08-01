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

`buildRecord(draft: RecordDraft)` normalizes a draft into a canonical `InternalRecord`. Only `ACCESSION` is required. It:

- Sorts both `PK$PEAK` and `PK$ANNOTATION` ascending by `mz`. Peaks keep their own `intensity` and `relativeIntensity` attached; annotation rows keep their own `annotation`/`exactMass`/`errorPpm` attached. A caller supplying either table in a deliberate order gets it silently reordered.
- Derives `PK$NUM_PEAK` from the sorted peak count — a draft-supplied value is discarded.
- Recomputes `PK$SPLASH` from the sorted peaks — a stale declared value is discarded, because a wrong SPLASH breaks cross-database matching silently, which is worse than a missing one.
- Strips `_original` from peaks and annotations, so the serializer can't fall back to stale round-trip text captured by an earlier parse.
- Drops an empty `PK$PEAK` or `PK$ANNOTATION` table rather than serializing a header with no rows. An empty peak list is **dropped, not hashed** — it never reaches the SPLASH computation and never throws.
- Drops `PK$NUM_PEAK` and `PK$SPLASH` when there are no peaks, so a stale count or hash can't survive a peakless draft.
- **Preserves duplicate `mz` values deliberately.** A duplicate can be a real instrument artifact; dropping the row loses data, and summing it invents a reading that was never measured.
- **Rejects `PK$ANNOTATION` rows the format cannot express.** `PK$ANNOTATION` is read back by token count, not by a fixed field order, so the legal combinations of `annotation`/`exactMass`/`errorPpm` are not simply "a prefix": `{}`, `{annotation}` (any text), `{exactMass, errorPpm}`, `{annotation, exactMass}` (non-numeric `annotation` only), and the full `{annotation, exactMass, errorPpm}` all round-trip; `exactMass` or `errorPpm` alone, and `{annotation, errorPpm}` without `exactMass`, do not. `annotation` must also be non-empty with no whitespace, and `mz`, `exactMass`, and `errorPpm` must all be finite. See the throwing/legal combinations below.
- Never mutates the draft passed in, but the returned record **shares array references** with it — `CH$NAME`, `COMMENT`, and `AC$MASS_SPECTROMETRY` are copied by reference, not deep-cloned. Mutating one of those arrays on the returned record mutates the same array on the original draft.

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
  // RangeError: PK$ANNOTATION row 0 (mz 100.25): exactMass is set without annotation or errorPpm. ...
}

// An all-zero, negative, or non-finite spectrum can't be hashed, so
// buildRecord throws instead of silently producing a record with no PK$SPLASH.
try {
  await buildRecord({
    ACCESSION: 'MSBNK-test-TST00001',
    PK$PEAK: [{ mz: 100.25, intensity: 0, relativeIntensity: 0 }],
  });
} catch (error) {
  // RangeError: Cannot calculate SPLASH for an all-zero-intensity spectrum.
}
```

`validateRecord(record: InternalRecord, options?: ValidationOptions)` validates a structured record by serializing it and delegating to `validateContent`, so the same bytes get the same verdict through either entry point.

Two limits are worth knowing:

1. **The filename is derived from `ACCESSION`** (as `` `${record.ACCESSION}.txt` ``), because an `InternalRecord` carries no filename of its own. `AccessionMatchRule` therefore **cannot fail** on this path for any well-formed accession — a green result is not evidence the accession matches any external filename. Use `validate()` or `validateContent()` with the real filename to check that.
2. **Mandatory fields and controlled vocabularies are not checked**, same as `validate`/`validateContent` today (see [MassBank Format 2.6.0 Compliance](#massbank-format-260-compliance)). A record containing only `ACCESSION` returns `success: true`. A green result means "round-trips and passes the current rule set," not "submittable to MassBank."

> `validateRecord` is the strict/submission entry point from 0.5.0: new semantic checks will be added to it in minor releases. `validate` and `validateContent` keep their current rule set.

### Additional exports

0.5.0 also exports, from the package root:

- `parseRecord` and `serializeRecord` — the parser and serializer `buildRecord`/`validateRecord` are built on
- `ParseException` — the error `parseRecord` throws on malformed input
- Types: `Annotation`, `InternalRecord`, `ParseError`, `Peak`, and `RecordDraft`

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

- `draft: RecordDraft` - A partial `InternalRecord` requiring only `ACCESSION`; `PK$PEAK`/`PK$ANNOTATION` accept the caller-facing `Peak`/`Annotation` shapes (no `_original`)

**Returns:** `Promise<InternalRecord>`

**Throws:** `RangeError` if a non-empty `PK$PEAK` cannot be hashed (all-zero intensity, a negative intensity, or a non-finite `mz`/`intensity`), or if a `PK$ANNOTATION` row cannot survive a round-trip — see [Builder API](#builder-api) above for the full legal/illegal combinations

### `validateRecord(record, options?)`

Validate a structured record. See [Builder API](#builder-api) above for the two limits this entry point has.

**Parameters:**

- `record: InternalRecord` - The structured record to validate
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
- Runtime dependencies: `camelcase`, `ensure-string`. `fifo-logger` is a type-only import (`ValidationOptions.logger`) — install it yourself if you pass a logger, otherwise it isn't required.

## License

[MIT](./LICENSE)
