import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { createMarkdown, createPythonCode, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { PercentCell, PercentNotebook } from './types/percent'
import { isMarkdownBlockType, sanitizeFileName } from './utils'

export interface ConvertDeepnoteFileToPercentOptions {
  outputDir: string
}

/**
 * Converts an array of Deepnote blocks into a percent format notebook.
 * This is the lowest-level conversion function.
 *
 * @param blocks - Array of DeepnoteBlock objects to convert
 * @returns A PercentNotebook object
 */
export function convertBlocksToPercentNotebook(blocks: DeepnoteBlock[]): PercentNotebook {
  const cells = blocks.map(block => convertBlockToCell(block))
  return { cells }
}

/**
 * Converts a Deepnote project into percent format notebook objects.
 * This is a pure conversion function that doesn't perform any file I/O.
 * Each notebook in the Deepnote project is converted to a separate percent notebook.
 *
 * @param deepnoteFile - The deserialized Deepnote project file
 * @returns Array of objects containing filename and corresponding percent notebook
 */
export function convertDeepnoteToPercentNotebooks(
  deepnoteFile: DeepnoteFile
): Array<{ filename: string; notebook: PercentNotebook }> {
  return deepnoteFile.project.notebooks.map(notebook => {
    const percentNotebook = convertBlocksToPercentNotebook(notebook.blocks)

    return {
      filename: `${sanitizeFileName(notebook.name)}.py`,
      notebook: percentNotebook,
    }
  })
}

/**
 * Serializes a percent format notebook to a string.
 *
 * @param notebook - The percent notebook to serialize
 * @returns The serialized percent format string
 */
export function serializePercentFormat(notebook: PercentNotebook): string {
  const lines: string[] = []

  for (const cell of notebook.cells) {
    // Build the cell marker
    let marker = '# %%'

    if (cell.cellType === 'markdown') {
      marker += ' [markdown]'
    } else if (cell.cellType === 'raw') {
      marker += ' [raw]'
    }

    if (cell.title) {
      marker += ` ${cell.title}`
    }

    if (cell.tags && cell.tags.length > 0) {
      const tagsStr = cell.tags.map(t => `"${t}"`).join(', ')
      marker += ` tags=[${tagsStr}]`
    }

    lines.push(marker)

    // Add cell content
    if (cell.cellType === 'markdown') {
      // Prefix each line with '# '
      const contentLines = cell.content.split('\n')
      for (const contentLine of contentLines) {
        if (contentLine === '') {
          lines.push('#')
        } else {
          lines.push(`# ${contentLine}`)
        }
      }
    } else {
      lines.push(cell.content)
    }

    // Add empty line between cells for readability
    lines.push('')
  }

  // Remove trailing empty line if present
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return `${lines.join('\n')}\n`
}

/**
 * Converts a Deepnote project file into separate percent format (.py) files.
 * Each notebook in the Deepnote project becomes a separate .py file.
 */
export async function convertDeepnoteFileToPercentFiles(
  deepnoteFilePath: string,
  options: ConvertDeepnoteFileToPercentOptions
): Promise<void> {
  const yamlContent = await fs.readFile(deepnoteFilePath, 'utf-8')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  const notebooks = convertDeepnoteToPercentNotebooks(deepnoteFile)

  await fs.mkdir(options.outputDir, { recursive: true })

  for (const { filename, notebook } of notebooks) {
    const filePath = join(options.outputDir, filename)
    const content = serializePercentFormat(notebook)
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

function convertBlockToCell(block: DeepnoteBlock): PercentCell {
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

  // Extract title and tags from metadata if present
  const title = block.metadata?.title as string | undefined
  const tags = block.metadata?.tags as string[] | undefined

  return {
    cellType: isMarkdown ? 'markdown' : 'code',
    content,
    ...(title ? { title } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  }
}
