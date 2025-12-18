import { parseDocument } from 'yaml'

/**
 * Validates UTF-8 encoding from raw bytes before decoding to string.
 * This is the proper way to validate UTF-8 - check BEFORE decoding.
 *
 * @param bytes - Raw file bytes as Uint8Array
 * @returns Decoded UTF-8 string without BOM
 * @throws Error if BOM detected or invalid UTF-8 encoding
 *
 * @example
 * ```typescript
 * const bytes = await fs.readFile('file.deepnote') // Returns Buffer/Uint8Array
 * const yamlContent = decodeUtf8NoBom(bytes)
 * const parsed = parseYaml(yamlContent)
 * ```
 */
export function decodeUtf8NoBom(bytes: Uint8Array): string {
  // Reject UTF-8 BOM (0xEF 0xBB 0xBF)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('UTF-8 BOM detected in Deepnote file - files must be UTF-8 without BOM')
  }

  // Validate UTF-8 by decoding with fatal=true
  // This will throw if the bytes contain invalid UTF-8 sequences
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Invalid UTF-8 encoding detected in Deepnote file')
  }
}

/**
 * Validates that a string doesn't start with BOM.
 * Note: This is a fallback when only a string is available.
 * By the time we have a JS string, invalid UTF-8 has already been handled during decoding.
 * For proper UTF-8 validation, use decodeUtf8NoBom() on raw bytes before decoding.
 *
 * @param yamlContent - Already-decoded YAML string
 * @throws Error if BOM prefix detected
 */
function validateNoBomPrefix(yamlContent: string): void {
  // Check for UTF-8 BOM that was decoded as U+FEFF
  if (yamlContent.charCodeAt(0) === 0xfeff) {
    throw new Error('UTF-8 BOM detected in Deepnote file - files must be UTF-8 without BOM')
  }
}

/**
 * Validates that the YAML document doesn't contain prohibited features:
 * - No anchors/aliases (&anchor, *alias)
 * - No merge keys (<<)
 * - No custom tags (!tag)
 */
function validateYamlStructure(yamlContent: string): void {
  // Check for anchors - must appear as a value after : or - (not in URLs or other content)
  // Matches patterns like "key: &anchor" or "- &anchor"
  if (/(?:^|\n)\s*(?:-\s+|[\w-]+:\s*)&\w+/.test(yamlContent)) {
    throw new Error('YAML anchors (&) are not allowed in Deepnote files')
  }

  // Check for aliases - must appear as a value after : or - (not in Markdown like *bold*)
  // Matches patterns like "key: *alias" or "- *alias"
  if (/(?:^|\n)\s*(?:-\s+|[\w-]+:\s*)\*\w+/.test(yamlContent)) {
    throw new Error('YAML aliases (*) are not allowed in Deepnote files')
  }

  // Check for merge keys
  if (/<<:/.test(yamlContent)) {
    throw new Error('YAML merge keys (<<) are not allowed in Deepnote files')
  }

  // Check for YAML tags (must appear after : or - at start of value, not inside strings)
  // Tags look like: "key: !tag value" or "- !tag value"
  // Tags can contain word chars, hyphens, and slashes: !custom-type, !python/object
  // We need to avoid false positives from ! inside quoted strings or as part of operators like !== or !event
  const tagPattern = /(?:^|\n)\s*(?:-\s+|[\w-]+:\s*)(![\w/-]+)/gm
  const matches = yamlContent.match(tagPattern)
  if (matches) {
    const tags = matches.map(m => m.match(/(![\w/-]+)/)?.[1]).filter(Boolean)
    if (tags.length > 0) {
      throw new Error(`YAML tags are not allowed in Deepnote files: ${tags.join(', ')}`)
    }
  }
}

/**
 * Parse and validate YAML document in a single pass.
 * Checks for duplicate keys and other parsing errors, then converts to JavaScript object.
 */
function parseAndValidate(yamlContent: string): unknown {
  const doc = parseDocument(yamlContent, {
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  })

  if (doc.errors.length > 0) {
    const duplicateKeyError = doc.errors.find(err => err.message.includes('duplicate') || err.message.includes('key'))
    if (duplicateKeyError) {
      throw new Error(`Duplicate keys detected in Deepnote file: ${duplicateKeyError.message}`)
    }
    throw new Error(`YAML parsing error: ${doc.errors[0].message}`)
  }

  return doc.toJS()
}

/**
 * Parse YAML content with strict validation rules:
 * - YAML 1.2 only
 * - UTF-8 only
 * - No duplicate keys
 * - No anchors/aliases/merge keys
 * - No custom tags
 * - Explicit typing enforced by schema
 */
export function parseYaml(yamlContent: string): unknown {
  try {
    // Validate no BOM prefix (string-level check only)
    // Note: For proper UTF-8 validation, use decodeUtf8NoBom() on raw bytes before calling this
    validateNoBomPrefix(yamlContent)

    // Validate YAML structure (no anchors, aliases, merge keys, custom tags)
    validateYamlStructure(yamlContent)

    // Parse and validate in a single pass (checks duplicate keys and converts to JS)
    const parsed = parseAndValidate(yamlContent)

    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Deepnote file: ${message}`)
  }
}
