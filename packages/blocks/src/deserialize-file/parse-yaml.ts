import { parse, parseDocument } from 'yaml'

/**
 * Validates that the YAML content is UTF-8 encoded.
 * Throws if invalid UTF-8 sequences are detected.
 */
function validateUtf8(yamlContent: string): void {
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
  // Check for anchors - must be preceded by whitespace or start of line
  // This avoids false positives from & in URLs or other content
  if (/(?:^|\s)&\w+/.test(yamlContent)) {
    throw new Error('YAML anchors (&) are not allowed in Deepnote files')
  }

  // Check for aliases - must be preceded by whitespace, colon, or dash
  // This avoids false positives from * in markdown (like **bold**)
  if (/(?:^|[\s:-])\*\w+/.test(yamlContent)) {
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
 * Checks for duplicate keys in the parsed YAML document.
 */
function checkDuplicateKeys(yamlContent: string): void {
  const doc = parseDocument(yamlContent, {
    strict: true,
    uniqueKeys: true,
  })

  if (doc.errors.length > 0) {
    const duplicateKeyError = doc.errors.find(err => err.message.includes('duplicate') || err.message.includes('key'))
    if (duplicateKeyError) {
      throw new Error(`Duplicate keys detected in Deepnote file: ${duplicateKeyError.message}`)
    }
    throw new Error(`YAML parsing error: ${doc.errors[0].message}`)
  }
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

    // Check for duplicate keys
    checkDuplicateKeys(yamlContent)

    // Parse with strict YAML 1.2 settings
    const parsed = parse(yamlContent, {
      strict: true,
      uniqueKeys: true,
      version: '1.2',
    })

    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Deepnote file: ${message}`)
  }
}
