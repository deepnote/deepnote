import fs from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { DeepnoteFile, DeepnoteRunFile, DeepnoteRunNotebook } from '@deepnote/blocks'
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
  const now = new Date()
  const createdAt = now.toISOString()

  const deepnoteFile: DeepnoteFile = {
    metadata: {
      createdAt,
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

  const runFile: DeepnoteRunFile = {
    metadata: {
      capturedAt: createdAt,
    },
    project: {
      id: deepnoteFile.project.id,
      name: options.projectName,
      notebooks: [],
    },
    version: deepnoteFile.version,
  }

  for (const filePath of inputFilePaths) {
    const extension = extname(filePath)
    const name = basename(filePath, extension) || 'Untitled notebook'

    const ipynb = await parseIpynbFile(filePath)

    const runtimeBlocks: DeepnoteRunNotebook['blocks'] = []

    const blocks = ipynb.cells.map((cell, index) => {
      const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source

      const blockGroupId = v4()
      const blockId = v4()

      const block = {
        blockGroup: blockGroupId,
        content: source,
        id: blockId,
        sortingKey: createSortingKey(index),
        type: cell.cell_type === 'code' ? 'code' : 'markdown',
        version: 1,
      }

      const runtimeBlock: DeepnoteRunNotebook['blocks'][number] = {
        id: blockId,
      }

      if (typeof cell.execution_count === 'number') {
        runtimeBlock.executionCount = cell.execution_count
      }

      const metadataEntries = cell.metadata ?? {}
      if (Object.keys(metadataEntries).length > 0) {
        runtimeBlock.metadata = metadataEntries
      }

      if (cell.cell_type === 'code') {
        runtimeBlock.outputs = cell.outputs ?? []
      }

      runtimeBlocks.push(runtimeBlock)

      return block
    })

    const notebookId = v4()
    const runtimeNotebook: DeepnoteRunNotebook = {
      id: notebookId,
      name,
      blocks: runtimeBlocks,
    }

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: notebookId,
      isModule: false,
      name,
      workingDirectory: undefined,
    })

    runFile.project.notebooks.push(runtimeNotebook)
  }

  const yamlContent = stringify(deepnoteFile)
  const runtimeYamlContent = stringify(runFile)

  const parentDir = dirname(options.outputPath)
  const deepnoteDir = join(parentDir, '.deepnote')
  const baseName = basename(options.outputPath, extname(options.outputPath))
  const runTimestamp = formatRunTimestamp(now)
  const runFilePath = join(deepnoteDir, `${baseName}.${runTimestamp}.deepnoterun`)
  const latestRunFilePath = join(deepnoteDir, `${baseName}.latestRun.deepnoterun`)

  await fs.mkdir(parentDir, { recursive: true })
  await fs.mkdir(deepnoteDir, { recursive: true })

  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
  await fs.writeFile(runFilePath, runtimeYamlContent, 'utf-8')
  await fs.writeFile(latestRunFilePath, runtimeYamlContent, 'utf-8')
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

function formatRunTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => value.toString().padStart(length, '0')

  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())
  const seconds = pad(date.getUTCSeconds())

  return `${year}${month}${day}${hours}${minutes}${seconds}Z`
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
