import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { createMarkdown, createPythonCode, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { JupyterCell, JupyterNotebook } from './types/jupyter'

export interface ConvertDeepnoteFileToJupyterOptions {
  outputDir: string
}

export interface ConvertBlocksToJupyterOptions {
  /** Unique identifier for the notebook */
  notebookId: string
  /** Display name of the notebook */
  notebookName: string
  /** Execution mode: 'block' runs cells individually, 'downstream' runs dependent cells */
  executionMode?: 'block' | 'downstream'
  /** Whether this notebook is a module (importable by other notebooks) */
  isModule?: boolean
  /** Working directory for the notebook */
  workingDirectory?: string
}

/**
 * Converts an array of Deepnote blocks into a single Jupyter Notebook.
 * This is the lowest-level conversion function, suitable for use in Deepnote Cloud.
 *
 * @param blocks - Array of DeepnoteBlock objects to convert
 * @param options - Notebook metadata options
 * @returns A JupyterNotebook object
 *
 * @example
 * ```typescript
 * import { convertBlocksToJupyterNotebook } from '@deepnote/convert'
 *
 * const notebook = convertBlocksToJupyterNotebook(blocks, {
 *   notebookId: 'abc123',
 *   notebookName: 'My Notebook',
 *   executionMode: 'block'
 * })
 * ```
 */
export function convertBlocksToJupyterNotebook(
  blocks: DeepnoteBlock[],
  options: ConvertBlocksToJupyterOptions
): JupyterNotebook {
  const cells = blocks.map(block => convertBlockToCell(block))

  return {
    cells,
    metadata: {
      deepnote_notebook_id: options.notebookId,
      deepnote_notebook_name: options.notebookName,
      deepnote_execution_mode: options.executionMode,
      deepnote_is_module: options.isModule,
      deepnote_working_directory: options.workingDirectory,
    },
    nbformat: 4,
    nbformat_minor: 0,
  }
}

/**
 * Converts a Deepnote project into Jupyter Notebook objects.
 * This is a pure conversion function that doesn't perform any file I/O.
 * Each notebook in the Deepnote project is converted to a separate Jupyter notebook.
 *
 * @param deepnoteFile - The deserialized Deepnote project file
 * @returns Array of objects containing filename and corresponding Jupyter notebook
 *
 * @example
 * ```typescript
 * import { deserializeDeepnoteFile } from '@deepnote/blocks'
 * import { convertDeepnoteToJupyterNotebooks } from '@deepnote/convert'
 *
 * const yamlContent = await fs.readFile('project.deepnote', 'utf-8')
 * const deepnoteFile = deserializeDeepnoteFile(yamlContent)
 * const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)
 *
 * for (const { filename, notebook } of notebooks) {
 *   console.log(`${filename}: ${notebook.cells.length} cells`)
 * }
 * ```
 */
export function convertDeepnoteToJupyterNotebooks(
  deepnoteFile: DeepnoteFile
): Array<{ filename: string; notebook: JupyterNotebook }> {
  return deepnoteFile.project.notebooks.map(notebook => {
    const jupyterNotebook = convertNotebookToJupyter(deepnoteFile, notebook)
    const fileName = `${sanitizeFileName(notebook.name)}.ipynb`

    return {
      filename: fileName,
      notebook: jupyterNotebook,
    }
  })
}

/**
 * Converts a Deepnote project file into separate Jupyter Notebook (.ipynb) files.
 * Each notebook in the Deepnote project becomes a separate .ipynb file.
 */
export async function convertDeepnoteFileToJupyterFiles(
  deepnoteFilePath: string,
  options: ConvertDeepnoteFileToJupyterOptions
): Promise<void> {
  const yamlContent = await fs.readFile(deepnoteFilePath, 'utf-8')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)

  await fs.mkdir(options.outputDir, { recursive: true })

  for (const { filename, notebook } of notebooks) {
    const filePath = join(options.outputDir, filename)
    await fs.writeFile(filePath, JSON.stringify(notebook, null, 2), 'utf-8')
  }
}

function convertBlockToCell(block: DeepnoteBlock): JupyterCell {
  const content = block.content || ''
  const jupyterCellType = convertBlockTypeToJupyter(block.type)

  const metadata: JupyterCell['metadata'] = {
    cell_id: block.id,
    deepnote_block_group: block.blockGroup,
    deepnote_cell_type: block.type,
    deepnote_sorting_key: block.sortingKey,

    // Spread original metadata at root level
    ...(block.metadata || {}),
  }

  // Store original content for lossless roundtrip conversion
  // createPythonCode and createMarkdown transform content
  // so we need to preserve the original for restoration
  metadata.deepnote_source = content

  const cell: JupyterCell = {
    block_group: block.blockGroup,
    cell_type: jupyterCellType,
    execution_count: block.executionCount ?? null,
    metadata,
    outputs: block.outputs,
    // TODO: Add outputs_reference
    source: getSourceForBlock(block, jupyterCellType, content),
  }

  return cell
}

function getSourceForBlock(block: DeepnoteBlock, jupyterCellType: 'code' | 'markdown', content: string): string {
  if (jupyterCellType === 'markdown') {
    return createMarkdown(block)
  }

  if (block.type === 'code') {
    return content
  }

  return createPythonCode(block)
}

function convertBlockTypeToJupyter(blockType: string): 'code' | 'markdown' {
  const codeTypes = ['big-number', 'button', 'code', 'notebook-function', 'sql', 'visualization']

  if (blockType.startsWith('input-')) {
    return 'code'
  }

  return codeTypes.includes(blockType) ? 'code' : 'markdown'
}

function convertNotebookToJupyter(
  _deepnoteFile: DeepnoteFile,
  notebook: DeepnoteFile['project']['notebooks'][0]
): JupyterNotebook {
  return convertBlocksToJupyterNotebook(notebook.blocks, {
    notebookId: notebook.id,
    notebookName: notebook.name,
    executionMode: notebook.executionMode as 'block' | 'downstream' | undefined,
    isModule: notebook.isModule,
    workingDirectory: notebook.workingDirectory,
  })
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-')
}
