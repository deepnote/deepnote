import type { DeepnoteFile } from '@deepnote/blocks'
import z from 'zod'
import { BUILTIN_INTEGRATIONS } from '../constants'

/**
 * Options for {@link collectRequiredIntegrationIds}.
 */
export interface CollectRequiredIntegrationIdsOptions {
  /**
   * Names of notebooks that must always be included in the scan, even when a
   * `notebookName` filter is provided. Used to express "init runs as a
   * prelude": when a user filters to a specific notebook, the init notebook's
   * required integrations must still be detected so missing config errors
   * fire before execution.
   */
  additionalNotebookNames?: string[]
}

/**
 * Collect unique external integration IDs referenced by SQL blocks in the file.
 * Excludes built-in integrations (e.g. deepnote-dataframe-sql, pandas-dataframe).
 *
 * When `notebookName` is provided, only that notebook is scanned, plus any
 * notebooks listed in `options.additionalNotebookNames` (typically the init
 * notebook for composed runs).
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
