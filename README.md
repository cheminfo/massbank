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

## MassBank Format 2.6.0 Compliance

This library enforces MassBank format 2.6.0 standards, including:

- **ACCESSION format:** `MSBNK-[ContributorID]-[RecordID]`
  - Contributor ID: up to 32 characters (letters, digits, underscore)
  - Record ID: up to 64 characters (capital letters, digits, underscore)
- **Filename matching:** File must be named `{ACCESSION}.txt`
- **Required fields:** ACCESSION, RECORD_TITLE, DATE, AUTHORS, LICENSE, and more
- **SPLASH validation:** Optional spectral hash validation via API

## Requirements

- Node.js 18+ (for native fetch support in SPLASH validation)
- No external runtime dependencies (only optional `fifo-logger`)

## License

[MIT](./LICENSE)
