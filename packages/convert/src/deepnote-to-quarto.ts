import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { createMarkdown, createPythonCode, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { QuartoCell, QuartoCellOptions, QuartoDocument, QuartoFrontmatter } from './types/quarto'
import { sanitizeFileName } from './utils'

export interface ConvertDeepnoteFileToQuartoOptions {
  outputDir: string
}

/**
 * Converts an array of Deepnote blocks into a Quarto document.
 * This is the lowest-level conversion function.
 *
 * @param blocks - Array of DeepnoteBlock objects to convert
 * @param notebookName - Name of the notebook (used for document title)
 * @returns A QuartoDocument object
 */
export function convertBlocksToQuartoDocument(blocks: DeepnoteBlock[], notebookName: string): QuartoDocument {
  const cells = blocks.map(block => convertBlockToCell(block))

  // Create frontmatter with title
  const frontmatter: QuartoFrontmatter = {
    title: notebookName,
    jupyter: 'python3',
  }

  return {
    frontmatter,
    cells,
  }
}

/**
 * Converts a Deepnote project into Quarto document objects.
 * This is a pure conversion function that doesn't perform any file I/O.
 * Each notebook in the Deepnote project is converted to a separate Quarto document.
 *
 * @param deepnoteFile - The deserialized Deepnote project file
 * @returns Array of objects containing filename and corresponding Quarto document
 */
export function convertDeepnoteToQuartoDocuments(
  deepnoteFile: DeepnoteFile
): Array<{ filename: string; document: QuartoDocument }> {
  return deepnoteFile.project.notebooks.map(notebook => {
    const document = convertBlocksToQuartoDocument(notebook.blocks, notebook.name)

    return {
      filename: `${sanitizeFileName(notebook.name)}.qmd`,
      document,
    }
  })
}

/**
 * Serializes a Quarto document to a string.
 *
 * @param document - The Quarto document to serialize
 * @returns The serialized Quarto format string
 */
export function serializeQuartoFormat(document: QuartoDocument): string {
  const lines: string[] = []

  // Add YAML frontmatter
  if (document.frontmatter && Object.keys(document.frontmatter).length > 0) {
    lines.push('---')
    for (const [key, value] of Object.entries(document.frontmatter)) {
      if (typeof value === 'string') {
        // Quote strings that contain special characters
        if (value.includes(':') || value.includes('#') || value.includes("'") || value.includes('"')) {
          lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`)
        } else {
          lines.push(`${key}: ${value}`)
        }
      } else if (typeof value === 'boolean') {
        lines.push(`${key}: ${value}`)
      } else if (value !== undefined) {
        lines.push(`${key}: ${JSON.stringify(value)}`)
      }
    }
    lines.push('---')
    lines.push('')
  }

  // Add cells
  for (const cell of document.cells) {
    if (cell.cellType === 'markdown') {
      lines.push(cell.content)
      lines.push('')
    } else {
      // Code cell
      const language = cell.language || 'python'
      lines.push(`\`\`\`{${language}}`)

      // Add cell options
      if (cell.options) {
        const optionLines = serializeQuartoCellOptions(cell.options)
        lines.push(...optionLines)
      }

      lines.push(cell.content)
      lines.push('```')
      lines.push('')
    }
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return `${lines.join('\n')}\n`
}

/**
 * Serializes Quarto cell options to #| format lines.
 */
function serializeQuartoCellOptions(options: QuartoCellOptions): string[] {
  const lines: string[] = []

  if (options.label) {
    lines.push(`#| label: ${options.label}`)
  }
  if (options.echo !== undefined) {
    lines.push(`#| echo: ${options.echo}`)
  }
  if (options.eval !== undefined) {
    lines.push(`#| eval: ${options.eval}`)
  }
  if (options.output !== undefined) {
    lines.push(`#| output: ${options.output}`)
  }
  if (options.figCap) {
    lines.push(`#| fig-cap: "${options.figCap}"`)
  }
  if (options.figWidth !== undefined) {
    lines.push(`#| fig-width: ${options.figWidth}`)
  }
  if (options.figHeight !== undefined) {
    lines.push(`#| fig-height: ${options.figHeight}`)
  }
  if (options.tblCap) {
    lines.push(`#| tbl-cap: "${options.tblCap}"`)
  }
  if (options.warning !== undefined) {
    lines.push(`#| warning: ${options.warning}`)
  }
  if (options.message !== undefined) {
    lines.push(`#| message: ${options.message}`)
  }

  // Add raw options
  if (options.raw) {
    for (const [key, value] of Object.entries(options.raw)) {
      if (typeof value === 'string') {
        lines.push(`#| ${key}: "${value}"`)
      } else {
        lines.push(`#| ${key}: ${value}`)
      }
    }
  }

  return lines
}

/**
 * Converts a Deepnote project file into separate Quarto (.qmd) files.
 * Each notebook in the Deepnote project becomes a separate .qmd file.
 */
export async function convertDeepnoteFileToQuartoFiles(
  deepnoteFilePath: string,
  options: ConvertDeepnoteFileToQuartoOptions
): Promise<void> {
  const yamlContent = await fs.readFile(deepnoteFilePath, 'utf-8')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  const documents = convertDeepnoteToQuartoDocuments(deepnoteFile)

  await fs.mkdir(options.outputDir, { recursive: true })

  for (const { filename, document } of documents) {
    const filePath = join(options.outputDir, filename)
    const content = serializeQuartoFormat(document)
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

function convertBlockToCell(block: DeepnoteBlock): QuartoCell {
  const isMarkdown = isMarkdownBlockType(block.type)

  let content: string
  if (isMarkdown) {
    try {
      content = createMarkdown(block)
    } catch {
      // Fallback to raw content for unsupported markdown block types
      content = block.content || ''
    }
  } else if (block.type === 'code') {
    content = block.content || ''
  } else {
    // For SQL, visualization, input blocks, etc., generate Python code
    try {
      content = createPythonCode(block)
    } catch {
      // Fallback to raw content for unsupported code block types
      content = block.content || ''
    }
  }

  // Build cell options from metadata
  let options: QuartoCellOptions | undefined
  const metadata = block.metadata || {}

  if (metadata.quarto_label || metadata.is_code_hidden || metadata.quarto_fig_cap || metadata.quarto_tbl_cap) {
    options = {}
    if (metadata.quarto_label) {
      options.label = metadata.quarto_label as string
    }
    if (metadata.is_code_hidden) {
      options.echo = false
    }
    if (metadata.quarto_fig_cap) {
      options.figCap = metadata.quarto_fig_cap as string
    }
    if (metadata.quarto_tbl_cap) {
      options.tblCap = metadata.quarto_tbl_cap as string
    }
    if (metadata.quarto_options) {
      options.raw = metadata.quarto_options as Record<string, unknown>
    }
  }

  const cell: QuartoCell = {
    cellType: isMarkdown ? 'markdown' : 'code',
    content,
    ...(options ? { options } : {}),
  }

  // Add language if specified in metadata
  if (metadata.language && metadata.language !== 'python') {
    cell.language = metadata.language as string
  }

  return cell
}

function isMarkdownBlockType(blockType: string): boolean {
  const markdownTypes = ['markdown', 'text', 'separator', 'heading', 'image']
  return markdownTypes.includes(blockType)
}
