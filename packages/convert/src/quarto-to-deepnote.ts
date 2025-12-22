import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'
import type { QuartoCell, QuartoCellOptions, QuartoDocument, QuartoFrontmatter } from './types/quarto'
import { createSortingKey } from './utils'

export interface ConvertQuartoFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ConvertQuartoDocumentOptions {
  /** Custom ID generator function. Defaults to uuid v4. */
  idGenerator?: () => string
}

export interface QuartoDocumentInput {
  filename: string
  document: QuartoDocument
}

/**
 * Parses a Quarto (.qmd) file into a QuartoDocument structure.
 *
 * @param content - The raw content of the .qmd file
 * @returns A QuartoDocument object
 *
 * @example
 * ```typescript
 * const content = `---
 * title: "My Document"
 * ---
 *
 * # Introduction
 *
 * \`\`\`{python}
 * print("hello")
 * \`\`\`
 * `
 * const doc = parseQuartoFormat(content)
 * ```
 */
export function parseQuartoFormat(content: string): QuartoDocument {
  const cells: QuartoCell[] = []

  // Parse YAML frontmatter
  let frontmatter: QuartoFrontmatter | undefined
  let mainContent = content

  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (frontmatterMatch) {
    frontmatter = parseYamlFrontmatter(frontmatterMatch[1])
    mainContent = content.slice(frontmatterMatch[0].length)
  }

  // Split content into chunks based on code fences
  // Match ```{language} ... ``` patterns
  const codeChunkRegex = /```\{(\w+)\}\r?\n([\s\S]*?)```/g

  let lastIndex = 0
  let match: RegExpExecArray | null = codeChunkRegex.exec(mainContent)

  while (match !== null) {
    // Add markdown before this code chunk
    const markdownBefore = mainContent.slice(lastIndex, match.index).trim()
    if (markdownBefore) {
      cells.push({
        cellType: 'markdown',
        content: markdownBefore,
      })
    }

    // Parse the code chunk
    const language = match[1]
    let codeContent = match[2]

    // Parse cell options (lines starting with #|)
    const options = parseQuartoCellOptions(codeContent)
    if (options) {
      // Remove option lines from content
      const lines = codeContent.split('\n')
      const contentLines = lines.filter(line => !line.trimStart().startsWith('#|'))
      codeContent = contentLines.join('\n').trim()
    } else {
      codeContent = codeContent.trim()
    }

    cells.push({
      cellType: 'code',
      content: codeContent,
      language,
      ...(options ? { options } : {}),
    })

    lastIndex = match.index + match[0].length
    match = codeChunkRegex.exec(mainContent)
  }

  // Add remaining markdown after last code chunk
  const markdownAfter = mainContent.slice(lastIndex).trim()
  if (markdownAfter) {
    cells.push({
      cellType: 'markdown',
      content: markdownAfter,
    })
  }

  return {
    ...(frontmatter ? { frontmatter } : {}),
    cells,
  }
}

/**
 * Parses YAML frontmatter string into a QuartoFrontmatter object.
 * This is a simplified parser - for production use, consider using a full YAML library.
 */
function parseYamlFrontmatter(yaml: string): QuartoFrontmatter {
  const frontmatter: QuartoFrontmatter = {}
  const lines = yaml.split('\n')

  for (const line of lines) {
    const match = /^(\w+):\s*(.*)$/.exec(line)
    if (match) {
      const key = match[1]
      let value: string | boolean = match[2].trim()

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      // Handle boolean values
      if (value === 'true') {
        frontmatter[key] = true
      } else if (value === 'false') {
        frontmatter[key] = false
      } else {
        frontmatter[key] = value
      }
    }
  }

  return frontmatter
}

/**
 * Parses Quarto cell options from #| lines.
 */
function parseQuartoCellOptions(content: string): QuartoCellOptions | undefined {
  const lines = content.split('\n')
  const optionLines = lines.filter(line => line.trimStart().startsWith('#|'))

  if (optionLines.length === 0) {
    return undefined
  }

  const options: QuartoCellOptions = {}
  const raw: Record<string, unknown> = {}

  for (const line of optionLines) {
    const match = /^#\|\s*(\S+):\s*(.*)$/.exec(line.trimStart())
    if (match) {
      const key = match[1]
      let value: string | boolean | number = match[2].trim()

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else if (value === 'true') {
        value = true
      } else if (value === 'false') {
        value = false
      } else if (!Number.isNaN(Number(value))) {
        value = Number(value)
      }

      // Map to typed properties
      switch (key) {
        case 'label':
          options.label = value as string
          break
        case 'echo':
          options.echo = value as boolean
          break
        case 'eval':
          options.eval = value as boolean
          break
        case 'output':
          options.output = value as boolean
          break
        case 'fig-cap':
          options.figCap = value as string
          break
        case 'fig-width':
          options.figWidth = value as number
          break
        case 'fig-height':
          options.figHeight = value as number
          break
        case 'tbl-cap':
          options.tblCap = value as string
          break
        case 'warning':
          options.warning = value as boolean
          break
        case 'message':
          options.message = value as boolean
          break
        default:
          raw[key] = value
      }
    }
  }

  if (Object.keys(raw).length > 0) {
    options.raw = raw
  }

  return Object.keys(options).length > 0 ? options : undefined
}

/**
 * Converts a single Quarto document into an array of Deepnote blocks.
 * This is the lowest-level conversion function.
 *
 * @param document - The Quarto document object to convert
 * @param options - Optional conversion options including custom ID generator
 * @returns Array of DeepnoteBlock objects
 */
export function convertQuartoDocumentToBlocks(
  document: QuartoDocument,
  options?: ConvertQuartoDocumentOptions
): DeepnoteBlock[] {
  const idGenerator = options?.idGenerator ?? v4
  const blocks: DeepnoteBlock[] = []

  // Add title from frontmatter as first markdown block if present
  if (document.frontmatter?.title) {
    blocks.push({
      blockGroup: idGenerator(),
      content: `# ${document.frontmatter.title}`,
      id: idGenerator(),
      metadata: {},
      sortingKey: createSortingKey(blocks.length),
      type: 'markdown',
    })
  }

  for (const cell of document.cells) {
    blocks.push(convertCellToBlock(cell, blocks.length, idGenerator))
  }

  return blocks
}

/**
 * Converts Quarto document objects into a Deepnote project file.
 * This is a pure conversion function that doesn't perform any file I/O.
 *
 * @param documents - Array of Quarto documents with filenames
 * @param options - Conversion options including project name
 * @returns A DeepnoteFile object
 */
export function convertQuartoDocumentsToDeepnote(
  documents: QuartoDocumentInput[],
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

  for (const { filename, document } of documents) {
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    // Use frontmatter title if available, otherwise use filename
    const notebookName = document.frontmatter?.title || filenameWithoutExt

    const blocks = convertQuartoDocumentToBlocks(document)

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: v4(),
      isModule: false,
      name: typeof notebookName === 'string' ? notebookName : filenameWithoutExt,
    })
  }

  return deepnoteFile
}

/**
 * Converts multiple Quarto (.qmd) files into a single Deepnote project file.
 */
export async function convertQuartoFilesToDeepnoteFile(
  inputFilePaths: string[],
  options: ConvertQuartoFilesToDeepnoteFileOptions
): Promise<void> {
  const documents: QuartoDocumentInput[] = []

  for (const filePath of inputFilePaths) {
    const content = await fs.readFile(filePath, 'utf-8')
    const document = parseQuartoFormat(content)
    documents.push({
      filename: basename(filePath),
      document,
    })
  }

  const deepnoteFile = convertQuartoDocumentsToDeepnote(documents, {
    projectName: options.projectName,
  })

  const yamlContent = stringify(deepnoteFile)

  const parentDir = dirname(options.outputPath)
  await fs.mkdir(parentDir, { recursive: true })
  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
}

function convertCellToBlock(cell: QuartoCell, index: number, idGenerator: () => string): DeepnoteBlock {
  const blockType = cell.cellType === 'markdown' ? 'markdown' : 'code'

  const metadata: Record<string, unknown> = {}

  // Preserve Quarto options in metadata
  if (cell.options) {
    if (cell.options.label) {
      metadata.quarto_label = cell.options.label
    }
    if (cell.options.echo === false) {
      metadata.is_code_hidden = true
    }
    if (cell.options.figCap) {
      metadata.quarto_fig_cap = cell.options.figCap
    }
    if (cell.options.tblCap) {
      metadata.quarto_tbl_cap = cell.options.tblCap
    }
    if (cell.options.raw) {
      metadata.quarto_options = cell.options.raw
    }
  }

  if (cell.language && cell.language !== 'python') {
    metadata.language = cell.language
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
