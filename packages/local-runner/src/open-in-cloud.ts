import { basename } from 'node:path'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { type UploadedNotebook, uploadNotebook } from '@deepnote/cloud'
import { applyInputOverrides } from './apply-input-overrides'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'

export interface OpenInCloudOptions {
  /** Deepnote domain. Defaults to `deepnote.com`. */
  domain?: string
  /** Input overrides to bake into the uploaded file. */
  inputs?: Record<string, unknown>
  /** File name to upload as. Defaults to the source file name, else `<project>.deepnote`. */
  fileName?: string
}

/**
 * Upload a local `.deepnote` to Deepnote ("Open in Deepnote") and return a launch URL to import it.
 * Opening the URL in a browser completes the import and creates the notebook in your workspace.
 */
export async function openInCloud(input: DeepnoteInput, options: OpenInCloudOptions = {}): Promise<UploadedNotebook> {
  const { file, sourcePath } = loadDeepnoteFile(input)
  if (options.inputs) {
    applyInputOverrides(file, options.inputs)
  }
  const yaml = serializeDeepnoteFile(file)
  const fileName =
    options.fileName ?? (sourcePath ? basename(sourcePath) : `${file.project.name || 'notebook'}.deepnote`)
  return uploadNotebook(new TextEncoder().encode(yaml), fileName, { domain: options.domain })
}
