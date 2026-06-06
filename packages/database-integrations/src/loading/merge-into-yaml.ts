import type { ApiIntegration } from './fetch-integrations'
import { parseIntegrationsDocument, serializeIntegrationsDocument } from './integrations-document'
import {
  createNewDocument,
  mergeApiIntegrationsIntoDocument,
  SCHEMA_COMMENT,
  type SkippedApiIntegration,
} from './merge-integrations'

export interface MergeApiIntegrationsIntoYamlResult {
  /** The updated YAML content (comments and formatting preserved). */
  content: string
  /** Extracted secrets, keyed by generated env var name. */
  secrets: Record<string, string>
  /** Merge statistics. */
  stats: {
    existingCount: number
    newCount: number
    updatedCount: number
  }
  /** API integrations skipped because they were invalid or unsupported. */
  skipped: SkippedApiIntegration[]
}

/**
 * Merge API integrations into existing integrations YAML content (or create a new
 * document), returning the serialized YAML, the extracted secrets, and merge stats.
 *
 * This is a string-in / string-out convenience that mirrors what `deepnote
 * integrations pull` does to the YAML file — usable without touching the `yaml`
 * Document API. Callers persist `content` and `secrets` however they like (e.g.
 * the CLI writes files; the VS Code extension can write via `workspace.fs`).
 *
 * @param existingContent - Current YAML content, or `null` if the file doesn't exist yet
 * @param apiIntegrations - Integrations fetched from the API
 */
export function mergeApiIntegrationsIntoYaml(
  existingContent: string | null,
  apiIntegrations: ApiIntegration[]
): MergeApiIntegrationsIntoYamlResult {
  const doc = (existingContent != null ? parseIntegrationsDocument(existingContent) : null) ?? createNewDocument()

  const { secrets, stats, skipped } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

  // Ensure schema comment is set
  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  return { content: serializeIntegrationsDocument(doc), secrets, stats, skipped }
}
