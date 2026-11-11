import { createHash } from 'node:crypto'
import { type DeepnoteFile, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { ImportedNotebook, MockContext, NotebookFile, Schemas } from './types'

const EPOCH = new Date(0).toISOString()

const decoder = new TextDecoder()

export function parseDocument(content: Uint8Array): DeepnoteFile {
  return deserializeDeepnoteFile(decoder.decode(content))
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The content hash from `packages/cloud/docs/project-import-contract.md`. */
export function canonicalHash(files: readonly NotebookFile[]): string {
  return sha256(
    files
      .map(({ filename, content }) => `${filename}\n${sha256(content)}`)
      .sort()
      .join('\n')
  )
}

export function projectModifiedAt(files: readonly NotebookFile[]): string {
  const first = files.at(0)
  return first ? (parseDocument(first.content).metadata.modifiedAt ?? EPOCH) : EPOCH
}

export function importedNotebooks(document: DeepnoteFile, action: ImportedNotebook['action']): ImportedNotebook[] {
  return document.project.notebooks.map(({ id, name }) => ({ id, name, action }))
}

export function dataAppSettings(
  { url, publishedDataApps }: MockContext,
  { id, projectType }: Pick<Schemas['ListProjectsItem'], 'id' | 'projectType'>
): Schemas['DataAppSettings'] | null {
  return projectType === 'data_app' ? { published: publishedDataApps.has(id), url: `${url}/apps/${id}/` } : null
}
