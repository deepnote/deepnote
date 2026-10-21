import type { ApiIntegration } from './fetch-integrations'
import { parseIntegrationsDocument, serializeIntegrationsDocument } from './integrations-document'
import {
  createNewDocument,
  type IntegrationsDocumentMergeResult,
  mergeApiIntegrationsIntoDocument,
  SCHEMA_COMMENT,
} from './merge-integrations'

export interface IntegrationsYamlDocumentMergeResult extends IntegrationsDocumentMergeResult {
  /** The updated YAML content (comments and formatting preserved). */
  content: string
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
 *
 * @throws {IntegrationsYamlParseError} If `existingContent` is not valid YAML (for
 * example, unresolved git merge conflict markers). Callers that want to rebuild the
 * file from scratch instead of surfacing the error can catch it and re-run with
 * `mergeApiIntegrationsIntoYaml(null, apiIntegrations)` — note this discards the
 * existing content, including any local-only integrations and comments.
 * @throws {InvalidIntegrationsTypeError} If the existing `integrations` property is
 * present but is not a list.
 */
export function mergeApiIntegrationsIntoYaml(
  existingContent: string | null,
  apiIntegrations: ApiIntegration[]
): IntegrationsYamlDocumentMergeResult {
  const doc = (existingContent != null ? parseIntegrationsDocument(existingContent) : null) ?? createNewDocument()

  const { secrets, stats, skipped } = mergeApiIntegrationsIntoDocument(doc, apiIntegrations)

  // Ensure schema comment is set
  if (doc.commentBefore == null || !doc.commentBefore.includes('yaml-language-server')) {
    doc.commentBefore = SCHEMA_COMMENT
  }

  return { content: serializeIntegrationsDocument(doc), secrets, stats, skipped }
}
