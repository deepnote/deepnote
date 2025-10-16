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
  metadata: Record<string, unknown>
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
  const deepnoteFile: DeepnoteFile = {
    metadata: {
      createdAt: new Date().toISOString(),
    },
    project: {
      id: v4(),
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

      const block = {
        blockGroup: v4(),
        content: source,
        executionCount: cell.execution_count ?? undefined,
        id: v4(),
        metadata: {},
        outputs: cell.cell_type === 'code' ? cell.outputs : undefined,
        sortingKey: createSortingKey(index),
        type: cell.cell_type === 'code' ? 'code' : 'markdown',
        version: 1,
      }

      return block
    })

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: v4(),
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
