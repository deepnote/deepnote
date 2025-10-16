import fs from 'node:fs/promises'
import { basename } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'

interface ConvertIpynbFilesToDeepnoteFileOptions {
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
    source: string
  }[]
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
}

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
    const filename = filePath.split('/').pop()
    const extension = filename?.split('.').pop()?.toLowerCase().trim()
    const name = filename ? basename(filename, `.${extension}`) : 'Untitled notebook'

    const ipynbJson = await fs.readFile(filePath, 'utf-8')
    const ipynb = JSON.parse(ipynbJson) as IpynbFile

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

  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
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
