import type { DeepnoteFile } from '@deepnote/blocks'
import z from 'zod'
import { isBuiltinIntegration } from '../constants'

/**
 * Collect unique external integration IDs referenced by SQL blocks in the file.
 *
 * Excludes built-in integrations (e.g. deepnote-dataframe-sql, pandas-dataframe)
 * case-insensitively. External IDs are deduplicated case-insensitively because
 * the downstream env-var derivation and API fetch are case-insensitive, so two
 * casings of the same ID refer to one integration. The first-seen original
 * casing is preserved as the single representative for display.
 */
export function collectRequiredIntegrationIds(file: DeepnoteFile, notebookName?: string): string[] {
  const notebooks = notebookName ? file.project.notebooks.filter(n => n.name === notebookName) : file.project.notebooks
  // Map of lowercased id -> first-seen original casing.
  const idsByLowercase = new Map<string, string>()
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      if (block.type === 'sql') {
        const metadata = block.metadata as Record<string, unknown>
        const integrationId = z.string().optional().safeParse(metadata.sql_integration_id).data
        if (integrationId && !isBuiltinIntegration(integrationId)) {
          const key = integrationId.toLowerCase()
          if (!idsByLowercase.has(key)) {
            idsByLowercase.set(key, integrationId)
          }
        }
      }
    }
  }
  return Array.from(idsByLowercase.values())
}
