import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'
import type { PercentCell, PercentNotebook } from './types/percent'
import { createSortingKey } from './utils'

export interface ConvertPercentFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ConvertPercentNotebookOptions {
  /** Custom ID generator function. Defaults to uuid v4. */
  idGenerator?: () => string
}

export interface PercentNotebookInput {
  filename: string
  notebook: PercentNotebook
}

/**
 * Parses a percent format Python file into a PercentNotebook structure.
 *
 * @param content - The raw content of the .py file
 * @returns A PercentNotebook object
 *
 * @example
 * ```typescript
 * const content = `# %% [markdown]
 * # # My Title
 *
 * # %%
 * print("hello")
 * `
 * const notebook = parsePercentFormat(content)
 * ```
 */
export function parsePercentFormat(content: string): PercentNotebook {
  const cells: PercentCell[] = []
  const lines = content.split('\n')

  // Handle empty content
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { cells: [] }
  }

  // Regular expression to match cell markers
  // Matches: # %% [type] title tags=["a", "b"]
  const cellMarkerRegex = /^# %%\s*(?:\[(\w+)\])?\s*(.*)$/

  let currentCell: PercentCell | null = null
  let currentContent: string[] = []

  function finalizeCell() {
    if (currentCell) {
      // For markdown cells, strip the '# ' prefix from each line
      if (currentCell.cellType === 'markdown') {
        currentCell.content = currentContent
          .map(line => {
            if (line.startsWith('# ')) {
              return line.slice(2)
            }
            if (line === '#') {
              return ''
            }
            return line
          })
          .join('\n')
          .trim()
      } else {
        currentCell.content = currentContent.join('\n').trim()
      }
      cells.push(currentCell)
    }
    currentContent = []
  }

  for (const line of lines) {
    const match = cellMarkerRegex.exec(line)

    if (match) {
      // Finalize previous cell
      finalizeCell()

      // Parse cell type and metadata
      const cellTypeStr = match[1]?.toLowerCase() || 'code'
      const rest = match[2]?.trim() || ''

      let cellType: 'code' | 'markdown' | 'raw' = 'code'
      if (cellTypeStr === 'markdown' || cellTypeStr === 'md') {
        cellType = 'markdown'
      } else if (cellTypeStr === 'raw') {
        cellType = 'raw'
      }

      // Parse tags and title from rest
      let title: string | undefined
      let tags: string[] | undefined

      const tagsMatch = /tags\s*=\s*\[([^\]]*)\]/.exec(rest)
      if (tagsMatch) {
        const tagsStr = tagsMatch[1]
        tags = tagsStr
          .split(',')
          .map(t => t.trim().replace(/^["']|["']$/g, ''))
          .filter(t => t.length > 0)

        // Remove tags from rest to get title
        const titlePart = rest.replace(/tags\s*=\s*\[[^\]]*\]/, '').trim()
        if (titlePart) {
          title = titlePart
        }
      } else if (rest) {
        title = rest
      }

      currentCell = {
        cellType,
        content: '',
        ...(title ? { title } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
      }
    } else if (currentCell) {
      // Add line to current cell content
      currentContent.push(line)
    } else {
      // Content before any cell marker - treat as code cell
      if (line.trim() !== '' || currentContent.length > 0) {
        currentCell = { cellType: 'code', content: '' }
        currentContent.push(line)
      }
    }
  }

  // Finalize last cell
  finalizeCell()

  return { cells }
}

/**
 * Converts a single percent format notebook into an array of Deepnote blocks.
 * This is the lowest-level conversion function.
 *
 * @param notebook - The percent notebook object to convert
 * @param options - Optional conversion options including custom ID generator
 * @returns Array of DeepnoteBlock objects
 */
export function convertPercentNotebookToBlocks(
  notebook: PercentNotebook,
  options?: ConvertPercentNotebookOptions
): DeepnoteBlock[] {
  const idGenerator = options?.idGenerator ?? v4
  return notebook.cells.map((cell, index) => convertCellToBlock(cell, index, idGenerator))
}

/**
 * Converts percent format notebook objects into a Deepnote project file.
 * This is a pure conversion function that doesn't perform any file I/O.
 *
 * @param notebooks - Array of percent notebooks with filenames
 * @param options - Conversion options including project name
 * @returns A DeepnoteFile object
 */
export function convertPercentNotebooksToDeepnote(
  notebooks: PercentNotebookInput[],
  options: { projectName: string }
): DeepnoteFile {
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

  for (const { filename, notebook } of notebooks) {
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    const blocks = convertPercentNotebookToBlocks(notebook)

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: v4(),
      isModule: false,
      name: filenameWithoutExt,
    })
  }

  return deepnoteFile
}

/**
 * Converts multiple percent format (.py) files into a single Deepnote project file.
 */
export async function convertPercentFilesToDeepnoteFile(
  inputFilePaths: string[],
  options: ConvertPercentFilesToDeepnoteFileOptions
): Promise<void> {
  const notebooks: PercentNotebookInput[] = []

  for (const filePath of inputFilePaths) {
    const content = await fs.readFile(filePath, 'utf-8')
    const notebook = parsePercentFormat(content)
    notebooks.push({
      filename: basename(filePath),
      notebook,
    })
  }

  const deepnoteFile = convertPercentNotebooksToDeepnote(notebooks, {
    projectName: options.projectName,
  })

  const yamlContent = stringify(deepnoteFile)

  const parentDir = dirname(options.outputPath)
  await fs.mkdir(parentDir, { recursive: true })
  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
}

function convertCellToBlock(cell: PercentCell, index: number, idGenerator: () => string): DeepnoteBlock {
  const blockType = cell.cellType === 'markdown' ? 'markdown' : 'code'

  const metadata: Record<string, unknown> = {}
  if (cell.title) {
    metadata.title = cell.title
  }
  if (cell.tags && cell.tags.length > 0) {
    metadata.tags = cell.tags
  }

  return {
    blockGroup: idGenerator(),
    content: cell.content,
    id: idGenerator(),
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
    sortingKey: createSortingKey(index),
    type: blockType,
  }
}
