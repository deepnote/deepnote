import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'

export interface ConvertIpynbFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

interface IpynbFile {
  cells: {
    cell_type: 'code' | 'markdown'
    execution_count?: number | null
    metadata: Record<string, unknown>
    // biome-ignore lint/suspicious/noExplicitAny: Jupyter notebook outputs can have various types
    outputs: any[]
    source: string | string[]
  }[]
  metadata: {
    deepnote?: {
      original_project_id?: string
      original_notebook_id?: string
    }
    [key: string]: unknown
  }
  nbformat: number
  nbformat_minor: number
}

/**
 * Converts multiple Jupyter Notebook (.ipynb) files into a single Deepnote project file.
 */
export async function convertIpynbFilesToDeepnoteFile(
  inputFilePaths: string[],
  options: ConvertIpynbFilesToDeepnoteFileOptions
): Promise<void> {
  // Try to get original project ID from first notebook if it exists
  let originalProjectId: string | undefined
  if (inputFilePaths.length > 0) {
    try {
      const firstIpynb = await parseIpynbFile(inputFilePaths[0])
      originalProjectId = firstIpynb.metadata?.deepnote?.original_project_id as string | undefined
    } catch {
      // Ignore errors, we'll just use a new ID
    }
  }

  const deepnoteFile: DeepnoteFile = {
    metadata: {
      createdAt: new Date().toISOString(),
    },
    project: {
      id: originalProjectId ?? v4(),
      initNotebookId: undefined,
      integrations: [],
      name: options.projectName,
      notebooks: [],
      settings: {},
    },
    version: '1.0.0',
  }

  for (const filePath of inputFilePaths) {
    const extension = extname(filePath)
    const name = basename(filePath, extension) || 'Untitled notebook'

    const ipynb = await parseIpynbFile(filePath)

    const blocks = ipynb.cells.map((cell, index) => {
      const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source

      // Check if cell has preserved Deepnote metadata
      const deepnoteMetadata = cell.metadata?.deepnote_to_be_reused as
        | {
            block_id?: string
            block_group?: string
            sorting_key?: string
          }
        | undefined

      // Filter out deepnote_to_be_reused from metadata when copying
      const { deepnote_to_be_reused: _, deepnote_cell_type: __, cell_id: ___, ...restMetadata } = cell.metadata || {}

      const block = {
        blockGroup: deepnoteMetadata?.block_group ?? v4(),
        content: source,
        executionCount: cell.execution_count ?? undefined,
        id: deepnoteMetadata?.block_id ?? v4(),
        metadata: restMetadata,
        outputs: cell.cell_type === 'code' ? cell.outputs : undefined,
        sortingKey: deepnoteMetadata?.sorting_key ?? createSortingKey(index),
        type: cell.cell_type === 'code' ? 'code' : 'markdown',
        version: 1,
      }

      return block
    })

    // Check if notebook has preserved ID
    const originalNotebookId = ipynb.metadata?.deepnote?.original_notebook_id as string | undefined

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: originalNotebookId ?? v4(),
      isModule: false,
      name,
      workingDirectory: undefined,
    })
  }

  const yamlContent = stringify(deepnoteFile)

  const parentDir = dirname(options.outputPath)

  await fs.mkdir(parentDir, { recursive: true })

  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
}

async function parseIpynbFile(filePath: string): Promise<IpynbFile> {
  let ipynbJson: string

  try {
    ipynbJson = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Failed to read ${filePath}: ${message}`)
  }

  try {
    return JSON.parse(ipynbJson) as IpynbFile
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`Failed to parse ${filePath}: invalid JSON - ${message}`)
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
