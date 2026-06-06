import { type Document, parseDocument } from 'yaml'

/**
 * Parse integrations YAML content into a mutable `yaml` Document that preserves
 * comments and formatting. Returns `null` for empty content.
 *
 * This is the content-accepting counterpart of the Node-only `readIntegrationsDocument`.
 */
export function parseIntegrationsDocument(content: string): Document | null {
  // Handle empty file
  if (!content.trim()) {
    return null
  }

  return parseDocument(content, {
    strict: true,
    version: '1.2',
  })
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
