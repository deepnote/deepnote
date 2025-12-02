import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'
import type { JupyterCell, JupyterNotebook } from './types/jupyter'

export interface ConvertIpynbFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ConvertJupyterNotebookOptions {
  /** Custom ID generator function. Defaults to uuid v4. */
  idGenerator?: () => string
}

export interface JupyterNotebookInput {
  filename: string
  notebook: JupyterNotebook
}

/**
 * Converts a single Jupyter Notebook into an array of Deepnote blocks.
 * This is the lowest-level conversion function, suitable for use in Deepnote Cloud.
 *
 * @param notebook - The Jupyter notebook object to convert
 * @param options - Optional conversion options including custom ID generator
 * @returns Array of DeepnoteBlock objects
 *
 * @example
 * ```typescript
 * import { convertJupyterNotebookToBlocks } from '@deepnote/convert'
 *
 * const notebook = JSON.parse(ipynbContent)
 * const blocks = convertJupyterNotebookToBlocks(notebook, {
 *   idGenerator: () => myCustomIdGenerator()
 * })
 * ```
 */
export function convertJupyterNotebookToBlocks(
  notebook: JupyterNotebook,
  options?: ConvertJupyterNotebookOptions
): DeepnoteBlock[] {
  const idGenerator = options?.idGenerator ?? v4
  return notebook.cells.map((cell, index) => convertCellToBlock(cell, index, idGenerator))
}

/**
 * Converts Jupyter Notebook objects into a Deepnote project file.
 * This is a pure conversion function that doesn't perform any file I/O.
 *
 * @param notebooks - Array of Jupyter notebooks with filenames
 * @param options - Conversion options including project name
 * @returns A DeepnoteFile object
 */
/**
 * Find project metadata from any notebook (prefer first, fallback to others).
 * This handles edge cases where the first notebook was deleted or notebooks were reordered.
 */
function findProjectMetadata(notebooks: JupyterNotebookInput[]) {
  for (const { notebook } of notebooks) {
    if (notebook?.metadata?.deepnote_project_id !== undefined) {
      return notebook.metadata
    }
  }
  return undefined
}

export function convertJupyterNotebooksToDeepnote(
  notebooks: JupyterNotebookInput[],
  options: { projectName: string }
): DeepnoteFile {
  // Find project metadata from any notebook (all notebooks have it for robustness)
  const projectMeta = findProjectMetadata(notebooks)

  // Determine if we have project metadata from a previous .deepnote → .ipynb conversion
  const hasProjectMeta = projectMeta?.deepnote_project_id !== undefined

  const deepnoteFile: DeepnoteFile = {
    metadata: {
      checksum: projectMeta?.deepnote_metadata_checksum,
      createdAt: projectMeta?.deepnote_metadata_created_at ?? new Date().toISOString(),
      exportedAt: projectMeta?.deepnote_metadata_exported_at,
      modifiedAt: projectMeta?.deepnote_metadata_modified_at,
    },
    project: {
      id: projectMeta?.deepnote_project_id ?? v4(),
      initNotebookId: projectMeta?.deepnote_project_init_notebook_id,
      integrations: hasProjectMeta ? (projectMeta?.deepnote_project_integrations ?? []) : [],
      name: projectMeta?.deepnote_project_name ?? options.projectName,
      notebooks: [],
      settings: hasProjectMeta ? (projectMeta?.deepnote_project_settings ?? {}) : {},
    },
    version: projectMeta?.deepnote_file_version ?? '1.0.0',
  }

  for (const { filename, notebook } of notebooks) {
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    const blocks = convertJupyterNotebookToBlocks(notebook)

    // Check if notebook has Deepnote metadata (from a previous conversion)
    const notebookId = notebook.metadata?.deepnote_notebook_id as string | undefined
    const notebookName = notebook.metadata?.deepnote_notebook_name as string | undefined
    const executionMode = notebook.metadata?.deepnote_execution_mode as 'block' | 'downstream' | undefined
    const isModule = notebook.metadata?.deepnote_is_module as boolean | undefined
    const workingDirectory = notebook.metadata?.deepnote_working_directory as string | undefined

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: executionMode ?? 'block',
      id: notebookId ?? v4(),
      isModule: isModule ?? false,
      name: notebookName ?? filenameWithoutExt,
      workingDirectory,
    })
  }

  return deepnoteFile
}

/**
 * Converts multiple Jupyter Notebook (.ipynb) files into a single Deepnote project file.
 */
export async function convertIpynbFilesToDeepnoteFile(
  inputFilePaths: string[],
  options: ConvertIpynbFilesToDeepnoteFileOptions
): Promise<void> {
  const notebooks: JupyterNotebookInput[] = []

  for (const filePath of inputFilePaths) {
    const notebook = await parseIpynbFile(filePath)
    notebooks.push({
      filename: basename(filePath),
      notebook,
    })
  }

  const deepnoteFile = convertJupyterNotebooksToDeepnote(notebooks, {
    projectName: options.projectName,
  })

  const yamlContent = stringify(deepnoteFile)

  const parentDir = dirname(options.outputPath)

  await fs.mkdir(parentDir, { recursive: true })

  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
}

async function parseIpynbFile(filePath: string): Promise<JupyterNotebook> {
  let ipynbJson: string

  try {
    ipynbJson = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Failed to read ${filePath}: ${message}`)
  }

  try {
    return JSON.parse(ipynbJson) as JupyterNotebook
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Failed to parse ${filePath}: invalid JSON - ${message}`)
  }
}

function convertCellToBlock(cell: JupyterCell, index: number, idGenerator: () => string): DeepnoteBlock {
  let source = Array.isArray(cell.source) ? cell.source.join('') : cell.source

  // Check if this cell has Deepnote metadata (from a previous conversion)
  const cellId = cell.metadata?.cell_id as string | undefined
  const deepnoteCellType = cell.metadata?.deepnote_cell_type as string | undefined
  const sortingKey = cell.metadata?.deepnote_sorting_key as string | undefined
  const blockVersion = cell.metadata?.deepnote_block_version as number | undefined

  // Determine blockGroup: prefer metadata, fall back to top-level field, then generate
  // Cloud-exported notebooks may have block_group at top level
  const blockGroup = cell.metadata?.deepnote_block_group ?? cell.block_group ?? idGenerator()

  // Restore original content from metadata if available (for lossless roundtrip)
  const deepnoteSource = cell.metadata?.deepnote_source as string | undefined
  if (deepnoteSource !== undefined) {
    source = deepnoteSource
  }

  const blockType = deepnoteCellType ?? (cell.cell_type === 'code' ? 'code' : 'markdown')

  // Extract original metadata (exclude Deepnote-specific fields)
  const originalMetadata = { ...cell.metadata }
  delete originalMetadata.cell_id
  delete originalMetadata.deepnote_cell_type
  delete originalMetadata.deepnote_block_group
  delete originalMetadata.deepnote_sorting_key
  delete originalMetadata.deepnote_source
  delete originalMetadata.deepnote_block_version
  // Also remove top-level block_group from metadata to avoid duplication
  delete (cell as { block_group?: unknown }).block_group

  // Build block object with fields in consistent order
  // Only include executionCount and outputs when they have values
  const executionCount = cell.execution_count ?? undefined
  const hasExecutionCount = executionCount !== undefined
  const hasOutputs = cell.cell_type === 'code' && cell.outputs !== undefined

  return {
    blockGroup,
    content: source,
    ...(hasExecutionCount ? { executionCount } : {}),
    id: cellId ?? idGenerator(),
    metadata: originalMetadata,
    ...(hasOutputs ? { outputs: cell.outputs } : {}),
    sortingKey: sortingKey ?? createSortingKey(index),
    type: blockType,
    ...(blockVersion !== undefined ? { version: blockVersion } : {}),
  }
}

function createSortingKey(index: number): string {
  const maxLength = 6
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  const base = chars.length

  if (index < 0) {
    throw new Error('Index must be non-negative')
  }

  let result = ''
  let num = index + 1
  let iterations = 0

  while (num > 0 && iterations < maxLength) {
    num--
    result = chars[num % base] + result
    num = Math.floor(num / base)
    iterations++
  }

  if (num > 0) {
    throw new Error(`Index ${index} exceeds maximum key length of ${maxLength}`)
  }

  return result
}
