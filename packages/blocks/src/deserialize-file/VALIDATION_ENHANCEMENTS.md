# Deepnote File Validation Enhancements

## Overview

Enhanced the `.deepnote` file validator with strict requirements to ensure file format consistency and security.

## Requirements Implemented

### 1. YAML 1.2 Only

- Parser configured with `version: '1.2'` option
- YAML 1.2 only recognizes `true`/`false` as booleans (not `yes`/`no`/`on`/`off` like YAML 1.1)
- More predictable and strict type coercion

### 2. UTF-8 Only (No BOM)

**Proper byte-level validation:**

- Added `decodeUtf8NoBom()` function for validating UTF-8 at the byte level (BEFORE decoding)
- Takes `Uint8Array` and validates with `TextDecoder('utf-8', { fatal: true })`
- Explicitly checks for and rejects UTF-8 BOM (0xEF 0xBB 0xBF)
- Detects invalid UTF-8 sequences, overlong encodings, and other malformed bytes
- **This is the proper way to validate UTF-8** - check raw bytes before decoding to string

**String-level fallback:**

- `validateNoBomPrefix()` checks for BOM in already-decoded strings (U+FEFF)
- Note: By the time we have a JS string, invalid UTF-8 has already been handled during decoding
- String-level validation can only detect BOM, not invalid UTF-8 sequences

**Recommendation:** Use `decodeUtf8NoBom(bytes)` when reading files to get proper UTF-8 validation

### 3. No Duplicate Keys

- Uses `parseDocument()` with `uniqueKeys: true` option
- Detects duplicate keys at any nesting level
- Provides clear error messages indicating which keys are duplicated

### 4. No Anchors/Aliases/Merge Keys

- Added `validateYamlStructure()` function with regex patterns to detect:
  - Anchors: `&anchor_name`
  - Aliases: `*alias_name`
  - Merge keys: `<<:`
- Patterns carefully crafted to avoid false positives:
  - Anchors/aliases must be preceded by whitespace to avoid matching `&` in URLs or `*` in markdown
  - Merge key pattern specifically looks for `<<:` sequence

### 5. No Custom Tags

- Detects any YAML tags (e.g., `!tag`, `!python/object`, etc.)
- Pattern matches tags that appear at the start of values (after `:` or `-`)
- Avoids false positives from `!` operators in JavaScript expressions within string values
- Ensures all type information comes from schema validation, not YAML tags

### 6. Explicit Typing via Schema

- All type validation is handled by the Zod schema (`deepnoteFileSchema`)
- Timestamps are validated as ISO 8601 strings (not Date objects)
- No implicit type conversions beyond YAML 1.2 core types

## Files Modified

### `packages/blocks/src/deserialize-file/parse-yaml.ts`

- Added `validateUtf8()` function
- Added `validateYamlStructure()` function
- Added `checkDuplicateKeys()` function
- Enhanced `parseYaml()` to call all validation functions
- Configured parser with strict YAML 1.2 settings

### `packages/blocks/src/deserialize-file/parse-yaml.test.ts`

- Added comprehensive test suite covering all validation rules:
  - UTF-8 validation tests
  - Duplicate key detection tests
  - Anchor/alias rejection tests
  - Merge key rejection tests
  - Custom tag rejection tests
  - Explicit typing tests (YAML 1.2 behavior)
- Total: 23 tests

### `packages/blocks/src/deserialize-file/validate-all-deepnote-files.test.ts` (new)

- Integration test that validates all 6 `.deepnote` files in the repository
- Ensures existing files comply with new strict requirements
- Verifies structure and metadata of parsed files

## Test Results

All 433 tests pass, including:

- 23 new parse-yaml tests
- 7 new validation tests for existing `.deepnote` files
- All existing tests continue to pass (backward compatible)

## Validation Against Existing Files

Successfully validated all `.deepnote` files in the repository:

- `packages/convert/test-fixtures/All-Deepnote-blocks.deepnote`
- `packages/convert/test-fixtures/ChartExamples.deepnote`
- `examples/1_hello_world.deepnote`
- `examples/2_blocks.deepnote`
- `examples/3_integrations.deepnote`
- `examples/demos/housing_price_prediction.deepnote`

All files pass the enhanced validation, confirming they already comply with the strict requirements.

## Error Messages

Clear, descriptive error messages for each validation failure:

- `"Invalid UTF-8 encoding detected in Deepnote file: BOM (Byte Order Mark) is not allowed"`
- `"Invalid UTF-8 encoding detected in Deepnote file"`
- `"YAML anchors (&) are not allowed in Deepnote files"`
- `"YAML aliases (*) are not allowed in Deepnote files"`
- `"YAML merge keys (<<) are not allowed in Deepnote files"`
- `"YAML tags are not allowed in Deepnote files: <list of tags>"`
- `"Duplicate keys detected in Deepnote file: <error details>"`

## Benefits

1. **Security**: No custom tags prevents code injection via YAML deserialization
2. **Consistency**: YAML 1.2 ensures predictable parsing across different parsers
3. **Reliability**: UTF-8 validation prevents encoding issues
4. **Correctness**: Duplicate key detection prevents ambiguous data
5. **Simplicity**: No anchors/aliases/merge keys keeps files simple and readable
6. **Type Safety**: Explicit schema-based typing prevents implicit conversion surprises
