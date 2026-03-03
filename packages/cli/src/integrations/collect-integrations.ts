import type { DeepnoteFile } from '@deepnote/blocks'
import z from 'zod'
import { BUILTIN_INTEGRATIONS } from '../constants'

/**
 * Collect unique external integration IDs referenced by SQL blocks in the file.
 * Excludes built-in integrations (e.g. deepnote-dataframe-sql, pandas-dataframe).
 */
export function collectRequiredIntegrationIds(file: DeepnoteFile, notebookName?: string): string[] {
  const notebooks = notebookName ? file.project.notebooks.filter(n => n.name === notebookName) : file.project.notebooks
  const ids = new Set<string>()
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      if (block.type === 'sql') {
        const metadata = block.metadata as Record<string, unknown>
        const integrationId = z.string().optional().safeParse(metadata.sql_integration_id).data
        if (integrationId && !BUILTIN_INTEGRATIONS.has(integrationId)) {
          ids.add(integrationId)
        }
      }
    }
  }
  return Array.from(ids)
}
