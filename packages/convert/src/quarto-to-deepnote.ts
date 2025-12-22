import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { parse as parseYaml, stringify } from 'yaml'
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

  // Match YAML frontmatter between --- markers (allows empty content)
  const frontmatterMatch = /^---\r?\n([\s\S]*?)---\r?\n?/.exec(content)
  if (frontmatterMatch) {
    const parsed = parseYamlFrontmatter(frontmatterMatch[1])
    // Always set frontmatter if there's a frontmatter block, even if empty
    frontmatter = parsed
    mainContent = content.slice(frontmatterMatch[0].length)
  }

  // Split content into chunks based on code fences
  // Match ```{language} ... ``` patterns
  // Allow hyphens in language identifiers (e.g., python-repl)
  const codeChunkRegex = /```\{([\w-]+)\}\r?\n([\s\S]*?)```/g

  let lastIndex = 0
  let match: RegExpExecArray | null = codeChunkRegex.exec(mainContent)

  while (match !== null) {
    // Add markdown before this code chunk
    const markdownBefore = mainContent.slice(lastIndex, match.index).trim()
    if (markdownBefore) {
      // Split at cell delimiters to preserve cell boundaries
      addMarkdownCells(cells, markdownBefore)
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
    // Split at cell delimiters to preserve cell boundaries
    addMarkdownCells(cells, markdownAfter)
  }

  return {
    ...(frontmatter ? { frontmatter } : {}),
    cells,
  }
}

/**
 * Splits markdown content at cell delimiter comments and adds each part as a separate cell.
 * The delimiter `<!-- cell -->` is used to preserve cell boundaries during roundtrip conversion.
 */
function addMarkdownCells(cells: QuartoCell[], content: string): void {
  // Split at cell delimiter, preserving cell boundaries
  const parts = content.split(/\s*<!--\s*cell\s*-->\s*/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed) {
      cells.push({
        cellType: 'markdown',
        content: trimmed,
      })
    }
  }
}

/**
 * Parses YAML frontmatter string into a QuartoFrontmatter object.
 * Uses the yaml package to properly handle nested objects, arrays, and all YAML features.
 */
function parseYamlFrontmatter(yamlString: string): QuartoFrontmatter {
  // Handle empty input
  if (!yamlString || yamlString.trim() === '') {
    return {}
  }

  try {
    const parsed = parseYaml(yamlString)

    // If parsing returns null or undefined, return empty object
    if (parsed === null || parsed === undefined) {
      return {}
    }

    // Ensure the result is an object (not a primitive or array)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed as QuartoFrontmatter
  } catch {
    // If YAML parsing fails, return empty object
    // In production, you might want to log this error
    return {}
  }
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
      } else {
        // Try to parse as number, but only if it's finite
        const num = Number(value)
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          value = num
        }
        // Otherwise keep as string
      }

      // Map to typed properties with runtime type validation
      switch (key) {
        case 'label':
          if (typeof value === 'string') {
            options.label = value
          } else {
            raw[key] = value
          }
          break
        case 'echo':
          if (typeof value === 'boolean') {
            options.echo = value
          } else if (value === 'true' || value === 'false') {
            options.echo = value === 'true'
          } else {
            raw[key] = value
          }
          break
        case 'eval':
          if (typeof value === 'boolean') {
            options.eval = value
          } else if (value === 'true' || value === 'false') {
            options.eval = value === 'true'
          } else {
            raw[key] = value
          }
          break
        case 'output':
          if (typeof value === 'boolean') {
            options.output = value
          } else if (value === 'true' || value === 'false') {
            options.output = value === 'true'
          } else {
            raw[key] = value
          }
          break
        case 'fig-cap':
          if (typeof value === 'string') {
            options.figCap = value
          } else {
            raw[key] = value
          }
          break
        case 'fig-width':
          if (typeof value === 'number' && Number.isFinite(value)) {
            options.figWidth = value
          } else if (typeof value === 'string') {
            const num = Number(value)
            if (!Number.isNaN(num) && Number.isFinite(num)) {
              options.figWidth = num
            } else {
              raw[key] = value
            }
          } else {
            raw[key] = value
          }
          break
        case 'fig-height':
          if (typeof value === 'number' && Number.isFinite(value)) {
            options.figHeight = value
          } else if (typeof value === 'string') {
            const num = Number(value)
            if (!Number.isNaN(num) && Number.isFinite(num)) {
              options.figHeight = num
            } else {
              raw[key] = value
            }
          } else {
            raw[key] = value
          }
          break
        case 'tbl-cap':
          if (typeof value === 'string') {
            options.tblCap = value
          } else {
            raw[key] = value
          }
          break
        case 'warning':
          if (typeof value === 'boolean') {
            options.warning = value
          } else if (value === 'true' || value === 'false') {
            options.warning = value === 'true'
          } else {
            raw[key] = value
          }
          break
        case 'message':
          if (typeof value === 'boolean') {
            options.message = value
          } else if (value === 'true' || value === 'false') {
            options.message = value === 'true'
          } else {
            raw[key] = value
          }
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
