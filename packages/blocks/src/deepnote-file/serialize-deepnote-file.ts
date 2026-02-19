import { stringify } from 'yaml'

import type { DeepnoteFile, DeepnoteSnapshot } from './deepnote-file-schema'
import { deepnoteFileSchema, deepnoteSnapshotSchema } from './deepnote-file-schema'

const yamlOptions = {
  indent: 2,
  lineWidth: 0,
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
} as const

/**
 * Serialize a DeepnoteFile to a YAML string.
 */
export function serializeDeepnoteFile(file: DeepnoteFile): string {
  // We pass object through zod schema to ensure stable fields order
  const normalized = deepnoteFileSchema.parse(file)
  return stringify(normalized, yamlOptions)
}

/**
 * Serialize a DeepnoteSnapshot to a YAML string.
 */
export function serializeDeepnoteSnapshot(snapshot: DeepnoteSnapshot): string {
  // We pass object through zod schema to ensure stable fields order
  const normalized = deepnoteSnapshotSchema.parse(snapshot)
  return stringify(normalized, yamlOptions)
}
