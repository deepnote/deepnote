import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { stringify } from 'yaml'
import type { MarimoApp, MarimoCell } from './types/marimo'
import { createSortingKey } from './utils'

/**
 * Splits a string on commas that are at the top level (not inside parentheses, brackets, braces, or string literals).
 * This handles cases like "func(a, b), other" and 'return "a,b", x' correctly.
 * Supports single quotes, double quotes, and backticks, with proper escape handling.
 */
function splitOnTopLevelCommas(str: string): string[] {
  const results: string[] = []
  let current = ''
  let depth = 0
  let inString: '"' | "'" | '`' | null = null
  let escaped = false

  for (const char of str) {
    // Handle escape sequences
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    // Handle string literals
    if (char === '"' || char === "'" || char === '`') {
      if (inString === null) {
        // Entering a string
        inString = char
      } else if (inString === char) {
        // Exiting a string (matching quote)
        inString = null
      }
      current += char
      continue
    }

    // If we're inside a string, just add the character
    if (inString !== null) {
      current += char
      continue
    }

    // Handle brackets/parens/braces (only when not in a string)
    if (char === '(' || char === '[' || char === '{') {
      depth++
      current += char
    } else if (char === ')' || char === ']' || char === '}') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      // Split on comma only at top level and not in a string
      results.push(current)
      current = ''
    } else {
      current += char
    }
  }

  // Don't forget the last segment
  if (current) {
    results.push(current)
  }

  return results
}

export interface ConvertMarimoFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ConvertMarimoAppOptions {
  /** Custom ID generator function. Defaults to crypto.randomUUID(). */
  idGenerator?: () => string
}

export interface MarimoAppInput {
  filename: string
  app: MarimoApp
}

/**
 * Parses a Marimo Python file into a MarimoApp structure.
 *
 * @param content - The raw content of the .py file
 * @returns A MarimoApp object
 *
 * @example
 * ```typescript
 * const content = `import marimo
 *
 * app = marimo.App()
 *
 * @app.cell
 * def __():
 *     print("hello")
 *     return
 * `
 * const app = parseMarimoFormat(content)
 * ```
 */
export function parseMarimoFormat(content: string): MarimoApp {
  const cells: MarimoCell[] = []

  // Extract version
  const versionMatch = /__generated_with\s*=\s*["']([^"']+)["']/.exec(content)
  const generatedWith = versionMatch?.[1]

  // Extract app width - handle both 'marimo.App' and 'mo.App'
  const widthMatch = /(?:marimo|mo)\.App\([^)]*width\s*=\s*["']([^"']+)["']/.exec(content)
  const width = widthMatch?.[1]

  // Extract title - handle both 'marimo.App' and 'mo.App'
  const titleMatch = /(?:marimo|mo)\.App\([^)]*title\s*=\s*["']([^"']+)["']/.exec(content)
  const title = titleMatch?.[1]

  // Parse cells - look for @app.cell decorated functions
  // This regex matches @app.cell (with optional parameters) followed by def
  // Capture group 1: decorator arguments (if any)
  // Capture group 2: function name
  // Capture group 3: function parameters
  // Capture group 4: function body
  const cellRegex =
    /@app\.cell(?:\(([^)]*)\))?\s*\n\s*def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*?)?\s*:\s*\n([\s\S]*?)(?=@app\.cell|if\s+__name__|$)/g

  let match: RegExpExecArray | null = cellRegex.exec(content)

  while (match !== null) {
    const decoratorArgs = match[1] || ''
    const functionName = match[2]
    const params = match[3].trim()
    let body = match[4]

    // Parse dependencies from parameters
    const dependencies = params
      ? params
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0)
      : undefined

    // Parse decorator arguments directly from the captured decorator line
    const hidden = /hide_code\s*=\s*True/.test(decoratorArgs)
    const disabled = /disabled\s*=\s*True/.test(decoratorArgs)

    // Find the base indentation level (the indent of the first non-empty line)
    // This is the cell's top-level code indent - we only strip returns at this level
    const lines = body.split('\n')
    const firstNonEmptyLine = lines.find(l => l.trim().length > 0)
    const baseIndentMatch = firstNonEmptyLine ? /^(\s*)/.exec(firstNonEmptyLine) : null
    const baseIndent = baseIndentMatch?.[1] || ''

    // Parse exports from the cell-level return statement (only at base indentation)
    // We look for the LAST return at the base indent level, as that's the cell's export declaration
    let exports: string[] | undefined
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      // Check if this line is a return at the base indentation level
      if (line.startsWith(baseIndent) && !line.startsWith(`${baseIndent} `) && !line.startsWith(`${baseIndent}\t`)) {
        const lineContent = line.slice(baseIndent.length)
        const returnMatch = /^return\s*([^\n]*?)(?:,\s*)?$/.exec(lineContent)
        if (returnMatch) {
          const returnVal = returnMatch[1].trim()
          if (returnVal && returnVal !== 'None' && returnVal !== '') {
            // Handle tuple returns like "df, pd," or "(df, pd)"
            const cleanReturn = returnVal.replace(/^\(|\)$/g, '').replace(/,\s*$/, '')
            // Split on top-level commas only (not inside parentheses)
            exports = splitOnTopLevelCommas(cleanReturn)
              .map(e => e.trim())
              .filter(e => e.length > 0 && e !== 'None')
            if (exports.length === 0) {
              exports = undefined
            }
          }
          break // Found the cell-level return, stop searching
        }
      }
    }

    // Remove ONLY the cell-level return statements (at base indentation), preserve nested ones
    const filteredLines = lines.filter(line => {
      // Normalize whitespace to handle tabs vs spaces consistently
      const normalizedLine = line.replace(/\t/g, '    ')
      const normalizedBaseIndent = baseIndent.replace(/\t/g, '    ')

      // Check if this line is at the base indentation level (not more indented)
      if (
        normalizedLine.startsWith(normalizedBaseIndent) &&
        !normalizedLine.startsWith(`${normalizedBaseIndent} `) &&
        !normalizedLine.startsWith(`${normalizedBaseIndent}\t`)
      ) {
        const lineContent = normalizedLine.slice(normalizedBaseIndent.length)
        // Remove return statements at the base level
        if (/^return\s*(?:[^\n]*)?(?:,\s*)?$/.test(lineContent)) {
          return false
        }
      }
      return true
    })

    // Remove common indentation
    let processedBody: string
    if (baseIndent.length > 0) {
      processedBody = filteredLines.map(l => (l.startsWith(baseIndent) ? l.slice(baseIndent.length) : l)).join('\n')
    } else {
      processedBody = filteredLines.join('\n')
    }

    // Trim leading/trailing empty lines (but preserve internal whitespace structure)
    body = processedBody.trim()

    // Check if it's a markdown cell (uses mo.md())
    const isMarkdown = /^\s*mo\.md\s*\(/.test(body) || /^\s*marimo\.md\s*\(/.test(body)

    // Check if it's a SQL cell (uses mo.sql())
    const isSql = /^\s*(?:\w+\s*=\s*)?(?:mo|marimo)\.sql\s*\(/.test(body)

    if (isMarkdown) {
      // Extract markdown content from mo.md() call
      // Support all valid Python string prefixes: r, f, rf, fr, or none
      const mdMatch =
        /(?:mo|marimo)\.md\s*\(\s*(?:(?:r|f|rf|fr)?(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)'))\s*\)/.exec(
          body
        )
      if (mdMatch) {
        const mdContent = mdMatch[1] || mdMatch[2] || mdMatch[3] || mdMatch[4] || ''
        cells.push({
          cellType: 'markdown',
          content: mdContent.trim(),
          functionName,
          ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
          ...(hidden ? { hidden } : {}),
          ...(disabled ? { disabled } : {}),
        })
      }
    } else if (isSql) {
      // Extract SQL query from mo.sql() call
      // Pattern: variable = mo.sql(f"""query""", engine=engine) or mo.sql("""query""", engine=engine)
      const sqlMatch =
        /(?:mo|marimo)\.sql\s*\(\s*(?:f)?(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)')\s*(?:,[\s\S]*)?\)/.exec(
          body
        )
      if (sqlMatch) {
        const sqlQuery = sqlMatch[1] || sqlMatch[2] || sqlMatch[3] || sqlMatch[4] || ''
        cells.push({
          cellType: 'sql',
          content: sqlQuery.trim(),
          functionName,
          ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
          ...(exports && exports.length > 0 ? { exports } : {}),
          ...(hidden ? { hidden } : {}),
          ...(disabled ? { disabled } : {}),
        })
      }
    } else {
      cells.push({
        cellType: 'code',
        content: body,
        functionName,
        ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
        ...(exports && exports.length > 0 ? { exports } : {}),
        ...(hidden ? { hidden } : {}),
        ...(disabled ? { disabled } : {}),
      })
    }

    match = cellRegex.exec(content)
  }

  return {
    ...(generatedWith ? { generatedWith } : {}),
    ...(width ? { width } : {}),
    ...(title ? { title } : {}),
    cells,
  }
}

/**
 * Converts a single Marimo app into an array of Deepnote blocks.
 * This is the lowest-level conversion function.
 *
 * @param app - The Marimo app object to convert
 * @param options - Optional conversion options including custom ID generator
 * @returns Array of DeepnoteBlock objects
 */
export function convertMarimoAppToBlocks(app: MarimoApp, options?: ConvertMarimoAppOptions): DeepnoteBlock[] {
  const idGenerator = options?.idGenerator ?? randomUUID
  return app.cells.map((cell, index) => convertCellToBlock(cell, index, idGenerator))
}

export interface ConvertMarimoAppsToDeepnoteOptions {
  /** Project name for the Deepnote file */
  projectName: string
  /** Custom ID generator function. Defaults to crypto.randomUUID(). */
  idGenerator?: () => string
}

/**
 * Converts Marimo app objects into a Deepnote project file.
 * This is a pure conversion function that doesn't perform any file I/O.
 *
 * @param apps - Array of Marimo apps with filenames
 * @param options - Conversion options including project name and optional ID generator
 * @returns A DeepnoteFile object
 */
export function convertMarimoAppsToDeepnote(
  apps: MarimoAppInput[],
  options: ConvertMarimoAppsToDeepnoteOptions
): DeepnoteFile {
  const idGenerator = options.idGenerator ?? randomUUID

  // Generate the first notebook ID upfront so we can use it as the project entrypoint
  const firstNotebookId = apps.length > 0 ? idGenerator() : undefined

  const deepnoteFile: DeepnoteFile = {
    metadata: {
      createdAt: new Date().toISOString(),
    },
    project: {
      id: idGenerator(),
      initNotebookId: firstNotebookId,
      integrations: [],
      name: options.projectName,
      notebooks: [],
      settings: {},
    },
    version: '1.0.0',
  }

  for (let i = 0; i < apps.length; i++) {
    const { filename, app } = apps[i]
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    // Use app title if available, otherwise use filename
    const notebookName = app.title || filenameWithoutExt

    const blocks = convertMarimoAppToBlocks(app, { idGenerator })

    // Use pre-generated ID for the first notebook, generate new ones for the rest
    const notebookId = i === 0 && firstNotebookId ? firstNotebookId : idGenerator()

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: notebookId,
      isModule: false,
      name: notebookName,
    })
  }

  return deepnoteFile
}

/**
 * Converts multiple Marimo (.py) files into a single Deepnote project file.
 */
export async function convertMarimoFilesToDeepnoteFile(
  inputFilePaths: string[],
  options: ConvertMarimoFilesToDeepnoteFileOptions
): Promise<void> {
  const apps: MarimoAppInput[] = []

  for (const filePath of inputFilePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const app = parseMarimoFormat(content)
      apps.push({
        filename: basename(filePath),
        app,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorStack = err instanceof Error ? err.stack : undefined
      throw new Error(`Failed to read or parse file ${basename(filePath)}: ${errorMessage}`, {
        cause: errorStack ? { originalError: err, stack: errorStack } : err,
      })
    }
  }

  const deepnoteFile = convertMarimoAppsToDeepnote(apps, {
    projectName: options.projectName,
  })

  const yamlContent = stringify(deepnoteFile)

  const parentDir = dirname(options.outputPath)
  await fs.mkdir(parentDir, { recursive: true })
  await fs.writeFile(options.outputPath, yamlContent, 'utf-8')
}

function convertCellToBlock(cell: MarimoCell, index: number, idGenerator: () => string): DeepnoteBlock {
  let blockType: 'code' | 'markdown' | 'sql'
  if (cell.cellType === 'markdown') {
    blockType = 'markdown'
  } else if (cell.cellType === 'sql') {
    blockType = 'sql'
  } else {
    blockType = 'code'
  }

  const metadata: Record<string, unknown> = {}

  // Preserve Marimo-specific info in metadata
  if (cell.dependencies && cell.dependencies.length > 0) {
    metadata.marimo_dependencies = cell.dependencies
  }
  if (cell.exports && cell.exports.length > 0) {
    metadata.marimo_exports = cell.exports
  }
  if (cell.hidden) {
    metadata.is_code_hidden = true
  }
  if (cell.disabled) {
    metadata.marimo_disabled = true
  }
  if (cell.functionName && cell.functionName !== '__') {
    metadata.marimo_function_name = cell.functionName
  }

  // For SQL blocks, set the variable name from exports if available
  if (cell.cellType === 'sql' && cell.exports && cell.exports.length > 0) {
    metadata.deepnote_variable_name = cell.exports[0]
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
