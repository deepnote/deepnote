import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { createMarkdown, createPythonCode, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { MarimoApp, MarimoCell } from './types/marimo'
import { isMarkdownBlockType, sanitizeFileName } from './utils'

export interface ConvertDeepnoteFileToMarimoOptions {
  outputDir: string
}

/** Current Marimo version for generated files */
const MARIMO_VERSION = '0.10.0'

/**
 * Converts an array of Deepnote blocks into a Marimo app.
 * This is the lowest-level conversion function.
 *
 * @param blocks - Array of DeepnoteBlock objects to convert
 * @param notebookName - Name of the notebook (used for app title)
 * @returns A MarimoApp object
 */
export function convertBlocksToMarimoApp(blocks: DeepnoteBlock[], notebookName: string): MarimoApp {
  const cells = blocks.map(block => convertBlockToCell(block))

  return {
    generatedWith: MARIMO_VERSION,
    width: 'medium',
    title: notebookName,
    cells,
  }
}

/**
 * Converts a Deepnote project into Marimo app objects.
 * This is a pure conversion function that doesn't perform any file I/O.
 * Each notebook in the Deepnote project is converted to a separate Marimo app.
 *
 * @param deepnoteFile - The deserialized Deepnote project file
 * @returns Array of objects containing filename and corresponding Marimo app
 */
export function convertDeepnoteToMarimoApps(deepnoteFile: DeepnoteFile): Array<{ filename: string; app: MarimoApp }> {
  return deepnoteFile.project.notebooks.map(notebook => {
    const app = convertBlocksToMarimoApp(notebook.blocks, notebook.name)

    return {
      filename: `${sanitizeFileName(notebook.name)}.py`,
      app,
    }
  })
}

/**
 * Serializes a Marimo app to a Python file string.
 *
 * @param app - The Marimo app to serialize
 * @returns The serialized Python code string
 */
export function serializeMarimoFormat(app: MarimoApp): string {
  const lines: string[] = []

  // Check if we have any markdown or SQL cells (both use mo.md() or mo.sql())
  const hasMarkdownOrSqlCells = app.cells.some(cell => cell.cellType === 'markdown' || cell.cellType === 'sql')

  // Add import - use 'as mo' alias if there are markdown or SQL cells
  if (hasMarkdownOrSqlCells) {
    lines.push('import marimo as mo')
  } else {
    lines.push('import marimo')
  }
  lines.push('')

  // Add version marker
  lines.push(`__generated_with = "${app.generatedWith || MARIMO_VERSION}"`)

  // Add app initialization - use mo or marimo based on import
  const appOptions: string[] = []
  if (app.width) {
    appOptions.push(`width="${app.width}"`)
  }
  if (app.title) {
    appOptions.push(`title="${escapeString(app.title)}"`)
  }
  const marimoRef = hasMarkdownOrSqlCells ? 'mo' : 'marimo'
  const optionsStr = appOptions.length > 0 ? appOptions.join(', ') : ''
  lines.push(`app = ${marimoRef}.App(${optionsStr})`)
  lines.push('')
  lines.push('')

  // Add cells
  for (const cell of app.cells) {
    // Build decorator
    const decoratorOptions: string[] = []
    if (cell.hidden) {
      decoratorOptions.push('hide_code=True')
    }
    if (cell.disabled) {
      decoratorOptions.push('disabled=True')
    }
    const decoratorStr = decoratorOptions.length > 0 ? `@app.cell(${decoratorOptions.join(', ')})` : '@app.cell'
    lines.push(decoratorStr)

    // Build function signature
    const funcName = cell.functionName || '__'
    const params = cell.dependencies?.join(', ') || ''
    lines.push(`def ${funcName}(${params}):`)

    // Add cell content
    if (cell.cellType === 'markdown') {
      // Wrap markdown in mo.md()
      const escaped = escapeTripleQuote(cell.content)
      lines.push(`    mo.md(r"""`)
      for (const contentLine of escaped.split('\n')) {
        lines.push(`    ${contentLine}`)
      }
      lines.push(`    """)`)
      lines.push('    return')
    } else if (cell.cellType === 'sql') {
      // Wrap SQL query in mo.sql()
      const escaped = escapeTripleQuote(cell.content)
      const varName = cell.exports && cell.exports.length > 0 ? cell.exports[0] : 'df'

      // Check if there's an 'engine' dependency for the SQL connection
      const hasEngine = cell.dependencies?.includes('engine')
      const engineParam = hasEngine ? ', engine=engine' : ''

      lines.push(`    ${varName} = mo.sql(`)
      lines.push(`        f"""`)
      for (const contentLine of escaped.split('\n')) {
        // Don't add indentation to empty lines
        if (contentLine === '' || contentLine.trim() === '') {
          lines.push('')
        } else {
          lines.push(`        ${contentLine}`)
        }
      }
      lines.push(`        """${engineParam}`)
      lines.push(`    )`)

      // Add return statement for exports
      if (cell.exports && cell.exports.length > 0) {
        lines.push(`    return ${cell.exports.join(', ')},`)
      } else {
        lines.push('    return')
      }
    } else {
      // Code cell
      const contentLines = cell.content.split('\n')
      for (const contentLine of contentLines) {
        // Don't add indentation to empty or whitespace-only lines
        if (contentLine.trim() === '') {
          lines.push('')
        } else {
          lines.push(`    ${contentLine}`)
        }
      }

      // Add return statement for exports
      if (cell.exports && cell.exports.length > 0) {
        lines.push(`    return ${cell.exports.join(', ')},`)
      } else {
        lines.push('    return')
      }
    }

    lines.push('')
    lines.push('')
  }

  // Add main block
  lines.push('if __name__ == "__main__":')
  lines.push('    app.run()')
  lines.push('')

  return lines.join('\n')
}

/**
 * Converts a Deepnote project file into separate Marimo (.py) files.
 * Each notebook in the Deepnote project becomes a separate .py file.
 */
export async function convertDeepnoteFileToMarimoFiles(
  deepnoteFilePath: string,
  options: ConvertDeepnoteFileToMarimoOptions
): Promise<void> {
  const yamlContent = await fs.readFile(deepnoteFilePath, 'utf-8')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  const apps = convertDeepnoteToMarimoApps(deepnoteFile)

  await fs.mkdir(options.outputDir, { recursive: true })

  for (const { filename, app } of apps) {
    const filePath = join(options.outputDir, filename)
    const content = serializeMarimoFormat(app)
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

function convertBlockToCell(block: DeepnoteBlock): MarimoCell {
  const isMarkdown = isMarkdownBlockType(block.type)
  const isSql = block.type === 'sql'
  const metadata = block.metadata || {}

  let content: string
  let cellType: 'code' | 'markdown' | 'sql'

  if (isMarkdown) {
    cellType = 'markdown'
    try {
      content = createMarkdown(block)
    } catch {
      // Fallback to raw content for unsupported markdown block types
      content = block.content || ''
    }
  } else if (isSql) {
    cellType = 'sql'
    // For SQL blocks, use the raw SQL query content
    content = block.content || ''
  } else if (block.type === 'code') {
    cellType = 'code'
    content = block.content || ''
  } else {
    cellType = 'code'
    // For visualization, input blocks, etc., generate Python code
    try {
      content = createPythonCode(block)
    } catch {
      // Fallback to raw content for unsupported code block types
      content = block.content || ''
    }
  }

  // Extract Marimo-specific metadata
  const dependencies = metadata.marimo_dependencies as string[] | undefined
  const exports = metadata.marimo_exports as string[] | undefined
  const hidden = metadata.is_code_hidden as boolean | undefined
  const disabled = metadata.marimo_disabled as boolean | undefined
  const functionName = metadata.marimo_function_name as string | undefined

  return {
    cellType,
    content,
    ...(functionName ? { functionName } : {}),
    ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
    ...(exports && exports.length > 0 ? { exports } : {}),
    ...(hidden ? { hidden } : {}),
    ...(disabled ? { disabled } : {}),
  }
}

/**
 * Escapes a string for use in a Python double-quoted string literal.
 * Handles backslashes, quotes, control characters, and non-printable characters.
 */
function escapeString(str: string): string {
  return (
    str
      .replace(/\\/g, '\\\\') // Backslash must be first
      .replace(/"/g, '\\"') // Double quotes
      .replace(/\n/g, '\\n') // Newline
      .replace(/\r/g, '\\r') // Carriage return
      .replace(/\t/g, '\\t') // Tab
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching backspace character
      .replace(/[\x08]/g, '\\b') // Backspace (use hex to avoid \b word boundary)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching form feed character
      .replace(/[\x0C]/g, '\\f') // Form feed (use hex to avoid literal control char)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control characters for escaping
      .replace(/[\x00-\x07\x0B\x0E-\x1F\x7F-\x9F]/g, char => {
        // Escape other control characters as \uXXXX
        const code = char.charCodeAt(0)
        return `\\u${code.toString(16).padStart(4, '0')}`
      })
  )
}

/**
 * Escapes content for use in a Python raw triple-quoted string (r""").
 * Raw strings don't interpret escape sequences, so we can't use backslashes to escape.
 * When we encounter triple quotes, we break the raw string and concatenate with a regular string.
 */
function escapeTripleQuote(str: string): string {
  // Split the raw string at """ and concatenate with a regular string containing the quote
  // r"""text""" becomes r"""text""" + '"' + r"""more"""
  return str.replace(/"""/g, '"""+\'"\'+r"""')
}
