import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile, Environment, Execution } from '@deepnote/blocks'
import { deepnoteBlockSchema, environmentSchema, executionSchema } from '@deepnote/blocks'
import { stringify } from 'yaml'
import type { JupyterCell, JupyterNotebook } from './types/jupyter'
import { createSortingKey, sortKeysAlphabetically } from './utils'

export interface ConvertIpynbFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ReadAndConvertIpynbFilesOptions {
  projectName: string
}

export interface ConvertJupyterNotebookOptions {
  /** Custom ID generator function. Defaults to crypto.randomUUID(). */
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
  const idGenerator = options?.idGenerator ?? randomUUID
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
export function convertJupyterNotebooksToDeepnote(
  notebooks: JupyterNotebookInput[],
  options: { projectName: string }
): DeepnoteFile {
  // Extract environment and execution from the first notebook that has them
  // (these are project-level fields stored in notebook metadata during conversion)
  let environment: Environment | undefined
  let execution: Execution | undefined

  for (const { notebook } of notebooks) {
    if (!environment && notebook.metadata?.deepnote_environment) {
      const parsed = environmentSchema.safeParse(notebook.metadata.deepnote_environment)
      if (parsed.success) {
        environment = parsed.data
      }
    }
    if (!execution && notebook.metadata?.deepnote_execution) {
      const parsed = executionSchema.safeParse(notebook.metadata.deepnote_execution)
      if (parsed.success) {
        execution = parsed.data
      }
    }
  }

  // Determine the first notebook's ID upfront so we can use it as the project entrypoint
  // Prefer ID from metadata (for roundtrip), otherwise generate a new one
  const firstNotebookId =
    notebooks.length > 0
      ? ((notebooks[0].notebook.metadata?.deepnote_notebook_id as string | undefined) ?? randomUUID())
      : undefined

  const deepnoteFile: DeepnoteFile = {
    environment,
    execution,
    metadata: {
      createdAt: new Date().toISOString(),
    },
    project: {
      id: randomUUID(),
      initNotebookId: firstNotebookId,
      integrations: [],
      name: options.projectName,
      notebooks: [],
      settings: {},
    },
    version: '1.0.0',
  }

  for (let i = 0; i < notebooks.length; i++) {
    const { filename, notebook } = notebooks[i]
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    const blocks = convertJupyterNotebookToBlocks(notebook)

    // Check if notebook has Deepnote metadata (from a previous conversion)
    const notebookId = notebook.metadata?.deepnote_notebook_id as string | undefined
    const notebookName = notebook.metadata?.deepnote_notebook_name as string | undefined
    const executionMode = notebook.metadata?.deepnote_execution_mode as 'block' | 'downstream' | undefined
    const isModule = notebook.metadata?.deepnote_is_module as boolean | undefined
    const workingDirectory = notebook.metadata?.deepnote_working_directory as string | undefined

    // Use pre-computed ID for first notebook to match initNotebookId
    const resolvedNotebookId = i === 0 && firstNotebookId ? firstNotebookId : (notebookId ?? randomUUID())

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: executionMode ?? 'block',
      id: resolvedNotebookId,
      isModule: isModule ?? false,
      name: notebookName ?? filenameWithoutExt,
      workingDirectory,
    })
  }

  return deepnoteFile
}

/**
 * Reads and converts multiple Jupyter Notebook (.ipynb) files into a DeepnoteFile.
 * This function reads the files and returns the converted DeepnoteFile without writing to disk.
 *
 * @param inputFilePaths - Array of paths to .ipynb files
 * @param options - Conversion options including project name
 * @returns A DeepnoteFile object
 */
export async function readAndConvertIpynbFiles(
  inputFilePaths: string[],
  options: ReadAndConvertIpynbFilesOptions
): Promise<DeepnoteFile> {
  const notebooks: JupyterNotebookInput[] = []

  for (const filePath of inputFilePaths) {
    const notebook = await parseIpynbFile(filePath)
    notebooks.push({
      filename: basename(filePath),
      notebook,
    })
  }

  return convertJupyterNotebooksToDeepnote(notebooks, {
    projectName: options.projectName,
  })
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

  // Restore snapshot fields from metadata
  const contentHash = cell.metadata?.deepnote_content_hash as string | undefined
  const executionStartedAt = cell.metadata?.deepnote_execution_started_at as string | undefined
  const executionFinishedAt = cell.metadata?.deepnote_execution_finished_at as string | undefined

  // Determine blockGroup: prefer metadata, fall back to top-level field, then generate
  // Cloud-exported notebooks may have block_group at top level
  const blockGroup = cell.metadata?.deepnote_block_group ?? cell.block_group ?? idGenerator()

  // Restore original content from metadata if available (for lossless roundtrip)
  const deepnoteSource = cell.metadata?.deepnote_source as string | undefined
  if (deepnoteSource !== undefined) {
    source = deepnoteSource
  }

  const blockType = (deepnoteCellType ?? (cell.cell_type === 'code' ? 'code' : 'markdown')) as DeepnoteBlock['type']

  // Extract original metadata (exclude Deepnote-specific fields)
  const originalMetadata = { ...cell.metadata }
  delete originalMetadata.cell_id
  delete originalMetadata.deepnote_cell_type
  delete originalMetadata.deepnote_block_group
  delete originalMetadata.deepnote_sorting_key
  delete originalMetadata.deepnote_source
  delete originalMetadata.deepnote_content_hash
  delete originalMetadata.deepnote_execution_started_at
  delete originalMetadata.deepnote_execution_finished_at
  // Also remove top-level block_group from metadata to avoid duplication
  delete (cell as { block_group?: unknown }).block_group

  // Build block object - order doesn't matter here since we sort alphabetically after parsing
  // Only include executionCount and outputs when they have values
  const executionCount = cell.execution_count ?? undefined
  const hasExecutionCount = executionCount !== undefined
  const hasOutputs = cell.cell_type === 'code' && cell.outputs !== undefined

  const parsed = deepnoteBlockSchema.parse({
    blockGroup,
    content: source,
    ...(contentHash ? { contentHash } : {}),
    ...(hasExecutionCount ? { executionCount } : {}),
    ...(executionFinishedAt ? { executionFinishedAt } : {}),
    ...(executionStartedAt ? { executionStartedAt } : {}),
    id: cellId ?? idGenerator(),
    metadata: originalMetadata,
    ...(hasOutputs ? { outputs: cell.outputs } : {}),
    sortingKey: sortingKey ?? createSortingKey(index),
    type: blockType,
  })

  // Sort keys alphabetically for stable YAML output
  return sortKeysAlphabetically(parsed)
}
