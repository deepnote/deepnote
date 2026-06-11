import type { DeepnoteFile } from '@deepnote/blocks'
import z from 'zod'
import { BUILTIN_INTEGRATIONS } from '../constants'

/**
 * Options for {@link collectRequiredIntegrationIds}.
 */
export interface CollectRequiredIntegrationIdsOptions {
  /** Notebooks always scanned even under a `notebookName` filter, so init's required integrations are still detected. */
  additionalNotebookNames?: string[]
}

/**
 * Collect unique external integration IDs referenced by SQL blocks in the file.
 * Excludes built-in integrations (e.g. deepnote-dataframe-sql, pandas-dataframe).
 *
 * When `notebookName` is provided, only that notebook plus `options.additionalNotebookNames` are scanned.
 */
export function collectRequiredIntegrationIds(
  file: DeepnoteFile,
  notebookName?: string,
  options: CollectRequiredIntegrationIdsOptions = {}
): string[] {
  const additional = new Set(options.additionalNotebookNames ?? [])
  const notebooks = notebookName
    ? file.project.notebooks.filter(n => n.name === notebookName || additional.has(n.name))
    : file.project.notebooks
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
