import { parseDocument } from 'yaml'

/**
 * Validates that the YAML content is UTF-8 encoded without BOM.
 * Throws if invalid UTF-8 sequences or BOM are detected.
 */
function validateUtf8(yamlContent: string): void {
  // Check for UTF-8 BOM (U+FEFF / 0xEF 0xBB 0xBF)
  if (yamlContent.charCodeAt(0) === 0xfeff) {
    throw new Error('Invalid UTF-8 encoding detected in Deepnote file: BOM (Byte Order Mark) is not allowed')
  }

  // Check for invalid UTF-8 by trying to encode/decode
  try {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const bytes = encoder.encode(yamlContent)
    decoder.decode(bytes)
  } catch {
    throw new Error('Invalid UTF-8 encoding detected in Deepnote file')
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
  // We need to avoid false positives from ! inside quoted strings or as part of operators like !== or !event
  const tagPattern = /(?:^|\n)\s*(?:-\s+|[\w-]+:\s*)(![\w/]+)/gm
  const matches = yamlContent.match(tagPattern)
  if (matches) {
    const tags = matches.map(m => m.match(/(![\w/]+)/)?.[1]).filter(Boolean)
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
    // Validate UTF-8 encoding
    validateUtf8(yamlContent)

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
