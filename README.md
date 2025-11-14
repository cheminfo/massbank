# massbank

[![NPM version](https://img.shields.io/npm/v/massbank.svg)](https://www.npmjs.com/package/massbank)
[![npm download](https://img.shields.io/npm/dm/massbank.svg)](https://www.npmjs.com/package/massbank)
[![test coverage](https://img.shields.io/codecov/c/github/cheminfo/massbank.svg)](https://codecov.io/gh/cheminfo/massbank)
[![license](https://img.shields.io/npm/l/massbank.svg)](https://github.com/cheminfo/massbank/blob/main/LICENSE)

A TypeScript/JavaScript library for validating MassBank record files. This library provides a pure TypeScript implementation of MassBank validation, matching the functionality of the official Java Validator tool.


## Installation

```console
npm install massbank
```

## Usage

### Basic Validation

```typescript
import { validate } from 'massbank';

// Validate a single file
const result = await validate('path/to/record.txt');

if (result.success) {
  console.log('Validation passed!');
  console.log('Accessions:', result.accessions);
} else {
  console.error('Validation failed:');
  result.errors.forEach((error) => {
    console.error(`  ${error.file}: ${error.message}`);
  });
}
```

### Validate Multiple Files or Directories

```typescript
import { validate } from 'massbank';

// Validate multiple files
const result = await validate(['record1.txt', 'record2.txt', 'record3.txt']);

// Validate a directory (recursively finds all .txt files)
const result = await validate('path/to/records/');
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

### Parse Records

```typescript
import { parseRecord } from 'massbank';

const recordText = `ACCESSION: MSBNK-test-00001
RECORD_TITLE: Test Record
//`;

const record = parseRecord(recordText);
console.log(record.ACCESSION); // "MSBNK-test-00001"
```

### Serialize Records

```typescript
import { parseRecord, serializeRecord } from 'massbank';

const record = parseRecord(recordText);
const serialized = serializeRecord(record);
```

### Simple Boolean Check

```typescript
import { isValid } from 'massbank';

const isValidRecord = await isValid(recordText);
if (isValidRecord) {
  console.log('Record is valid!');
}
```

## Validation Rules

The validator performs the following checks:

1. **Parse Validation** - Ensures the record can be parsed correctly
2. **ACCESSION Matching** - Validates that ACCESSION matches the filename
3. **Non-Standard Characters** - Warns on non-standard ASCII characters
4. **Serialization Round-Trip** - Ensures parse → serialize → compare matches exactly
5. **Duplicate Detection** - Checks for duplicate accessions across all files
6. **Legacy Mode** - Less strict validation for legacy records

## API Reference

### `validate(paths, options?)`

Main validation function.

**Parameters:**

- `paths: string | string[]` - File path(s) or directory path(s) to validate
- `options?: ValidationOptions` - Optional validation options

**Returns:** `Promise<ValidationResult>`

**ValidationResult:**

```typescript
interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  accessions: string[];
  filesProcessed: number;
}
```

### `parseRecord(text)`

Parse a MassBank record string into a Record object.

**Parameters:**

- `text: string` - The MassBank record text

**Returns:** `Record`

**Throws:** `ParseException` if parsing fails

### `serializeRecord(record)`

Serialize a Record object back to MassBank record string format.

**Parameters:**

- `record: Record` - The record to serialize

**Returns:** `string`

### `isValid(text, options?)`

Simple boolean check for record validity.

**Parameters:**

- `text: string` - The MassBank record text
- `options?: IsValidOptions` - Optional validation options

**Returns:** `Promise<boolean>`

## Extending Validation

You can add custom validation rules:

```typescript
import { MassBankValidator, IValidationRule } from 'massbank';
import type { Record, ValidationError, ValidationWarning } from 'massbank';

class CustomRule implements IValidationRule {
  validate(record: Record, originalText: string, filename: string, options) {
    const errors: ValidationError[] = [];
    // Your validation logic
    return errors;
  }

  getWarnings(record: Record, originalText: string, filename: string, options) {
    const warnings: ValidationWarning[] = [];
    // Your warning logic
    return warnings;
  }
}

const validator = new MassBankValidator();
validator.addRule(new CustomRule());
```


### Key Components

- **Parser** - Parses MassBank record format with extensible field parsers
- **Serializer** - Serializes records back to text format
- **Validation Rules** - Strategy pattern for validation rules
- **Validator** - Orchestrates validation process
- **SPLASH** - SPLASH validation support (via API)

## Requirements

- Node.js 18+ (for native fetch support, or use a fetch polyfill)
- No external dependencies beyond Node.js built-ins

## License

[MIT](./LICENSE)
