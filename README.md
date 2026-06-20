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

## Validation Rules

The validator performs the following checks:

1. **Parse Validation** - Ensures the record can be parsed correctly according to MassBank format 2.6.0
2. **ACCESSION Matching** - Validates that ACCESSION field matches the filename (CRITICAL for MassBank-data repository)
   - Example: File `MSBNK-test-TST00001.txt` must contain `ACCESSION: MSBNK-test-TST00001`
3. **Unrecognized Fields** - Warns about unrecognized field names (helps catch typos like `RECRD_TITLE` instead of `RECORD_TITLE`)
4. **Non-Standard Characters** - Warns about non-standard ASCII characters (non-blocking)
5. **Serialization Round-Trip** - Ensures parse → serialize → compare matches exactly (guarantees no data loss)
6. **SPLASH** - Recomputes the canonical SPLASH **offline** from the peak list and compares it to `PK$SPLASH`; a mismatch is a blocking error (no network, no fail-open). A record with no `PK$SPLASH` is skipped — generating one is the caller's choice (see `fillSplash` / `resolveSplash`).

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

### SPLASH

[SPLASH](https://splash.fiehnlab.ucdavis.edu/) (SPectraL hASH) is a deterministic content hash of a mass spectrum. It is computed locally and offline (Web Crypto, browser-compatible — no network), so computation and validation are deterministic and require no external service.

```typescript
import {
  calculateSplash,
  resolveSplash,
  resolveSplashFromRecord,
  fillSplash,
} from 'massbank';

// Compute the canonical SPLASH from a peak list.
const splash = await calculateSplash([{ mz: 117.0572, intensity: 100 }]);

// Reconcile a record's declared PK$SPLASH against the peaks (pure, never mutates).
const outcome = await resolveSplashFromRecord(recordText);
switch (outcome.status) {
  case 'computed': // PK$SPLASH was missing → outcome.splash is canonical
  case 'verified': // declared matches the computed SPLASH
  case 'mismatch': // declared is wrong → outcome.computed vs outcome.declared
  case 'notApplicable': // no/zero/unhashable peaks → outcome.reason
}

// Return the record text with a correct PK$SPLASH inserted/replaced.
const filled = await fillSplash(recordText);
```

- **`calculateSplash(peaks)`** → `Promise<string>` — the canonical `splash10-…` hash. Throws `RangeError` for an empty, all-zero, or non-finite/negative spectrum.
- **`resolveSplash(peaks, declared?)`** / **`resolveSplashFromRecord(text)`** → `Promise<SplashOutcome>` — pure inspection. Never throws, never mutates. `SplashOutcome` is a discriminated union of `computed` / `verified` / `mismatch` / `notApplicable`. The `mismatch` case has no single `splash` field, so a wrong value cannot be trusted by accident.
- **`fillSplash(text)`** → `Promise<string>` — explicit generation: returns the record text with `PK$SPLASH` set to the canonical value (inserted in canonical position, or replaced).

Inspection (`resolveSplash`), generation (`fillSplash`), and validation (`validate`) are separate, so consumers own their flow (auto-fill vs. user-approved).

## MassBank Format 2.6.0 Compliance

This library enforces MassBank format 2.6.0 standards, including:

- **ACCESSION format:** `MSBNK-[ContributorID]-[RecordID]`
  - Contributor ID: up to 32 characters (letters, digits, underscore)
  - Record ID: up to 64 characters (capital letters, digits, underscore)
- **Filename matching:** File must be named `{ACCESSION}.txt`
- **Required fields:** ACCESSION, RECORD_TITLE, DATE, AUTHORS, LICENSE, and more
- **SPLASH validation:** `PK$SPLASH` is recomputed offline and compared against the peak list

## Requirements

- Node.js 20+ (or a 2023-era evergreen browser) — uses Web Crypto and `Array.prototype.toSorted()`
- No external runtime dependencies (only optional `fifo-logger`)
- Browser-compatible: `validateContent`, `getVariables`, and all SPLASH functions run in the browser; only `validate` (file I/O) is Node-only

## License

[MIT](./LICENSE)
