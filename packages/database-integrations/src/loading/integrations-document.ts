import { type Document, parseDocument, type YAMLError } from 'yaml'

/**
 * Error thrown when integrations YAML content cannot be parsed.
 */
export class IntegrationsYamlParseError extends Error {
  /** The underlying parse errors reported by the `yaml` library. */
  readonly errors: YAMLError[]

  constructor(errors: YAMLError[]) {
    super(`Failed to parse integrations YAML: ${errors[0]?.message ?? 'unknown parse error'}`)
    this.name = 'IntegrationsYamlParseError'
    this.errors = errors
  }
}

/**
 * Parse integrations YAML content into a mutable `yaml` Document that preserves
 * comments and formatting. Returns `null` for empty content.
 *
 * This is the content-accepting counterpart of the Node-only `readIntegrationsDocument`.
 *
 * @throws {IntegrationsYamlParseError} If the content is not valid YAML. Malformed
 * content is rejected here rather than at serialization time, where `yaml` would
 * otherwise fail with an opaque "Document with errors cannot be stringified".
 */
export function parseIntegrationsDocument(content: string): Document | null {
  // Handle empty file
  if (!content.trim()) {
    return null
  }

  const doc = parseDocument(content, {
    strict: true,
    version: '1.2',
  })

  if (doc.errors.length > 0) {
    throw new IntegrationsYamlParseError(doc.errors)
  }

  return doc
}

/**
 * Serialize an integrations Document back to YAML text, preserving comments and
 * formatting and avoiding line wrapping.
 */
export function serializeIntegrationsDocument(doc: Document): string {
  return doc.toString({
    lineWidth: 0, // Don't wrap long lines
  })
}
