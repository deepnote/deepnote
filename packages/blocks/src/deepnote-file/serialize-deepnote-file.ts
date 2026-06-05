import { stringify } from 'yaml'

import type { DeepnoteFile, DeepnoteSnapshot } from './deepnote-file-schema'
import { deepnoteFileSchema, deepnoteSnapshotSchema } from './deepnote-file-schema'

const yamlOptions = {
  indent: 2,
  lineWidth: 120,
  blockQuote: 'folded',
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
} as const

export function generateSortingKey(index: number): string {
  return String(index).padStart(6, '0')
}

function normalizeSortingKeys<T extends DeepnoteFile | DeepnoteSnapshot>(data: T): T {
  return {
    ...data,
    project: {
      ...data.project,
      notebooks: data.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map((block, index) => ({
          ...block,
          sortingKey: generateSortingKey(index),
        })),
      })),
    },
  }
}

/**
 * Serialize a DeepnoteFile to a YAML string.
 */
export function serializeDeepnoteFile(file: DeepnoteFile): string {
  // We pass object through zod schema to ensure stable fields order
  const withNormalizedSortingKeys = normalizeSortingKeys(file)
  const normalized = deepnoteFileSchema.parse(withNormalizedSortingKeys)
  return stringify(normalized, yamlOptions)
}

/**
 * Serialize a DeepnoteSnapshot to a YAML string.
 */
export function serializeDeepnoteSnapshot(snapshot: DeepnoteSnapshot): string {
  // We pass object through zod schema to ensure stable fields order
  const withNormalizedSortingKeys = normalizeSortingKeys(snapshot)
  const normalized = deepnoteSnapshotSchema.parse(withNormalizedSortingKeys)
  return stringify(normalized, yamlOptions)
}
