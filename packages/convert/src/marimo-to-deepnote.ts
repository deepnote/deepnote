import fs from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { v4 } from 'uuid'
import { stringify } from 'yaml'
import type { MarimoApp, MarimoCell } from './types/marimo'

export interface ConvertMarimoFilesToDeepnoteFileOptions {
  outputPath: string
  projectName: string
}

export interface ConvertMarimoAppOptions {
  /** Custom ID generator function. Defaults to uuid v4. */
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

  // Extract app width
  const widthMatch = /marimo\.App\([^)]*width\s*=\s*["']([^"']+)["']/.exec(content)
  const width = widthMatch?.[1]

  // Extract title
  const titleMatch = /marimo\.App\([^)]*title\s*=\s*["']([^"']+)["']/.exec(content)
  const title = titleMatch?.[1]

  // Parse cells - look for @app.cell decorated functions
  // This regex matches @app.cell (with optional parameters) followed by def
  const cellRegex =
    /@app\.cell(?:\([^)]*\))?\s*\n\s*def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*?)?\s*:\s*\n([\s\S]*?)(?=@app\.cell|if\s+__name__|$)/g

  let match: RegExpExecArray | null = cellRegex.exec(content)

  while (match !== null) {
    const functionName = match[1]
    const params = match[2].trim()
    let body = match[3]

    // Parse dependencies from parameters
    const dependencies = params
      ? params
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0)
      : undefined

    // Parse exports from return statement
    let exports: string[] | undefined
    const returnMatch = /return\s+([^#\n]+?)(?:,\s*)?(?:\n|$)/.exec(body)
    if (returnMatch) {
      const returnVal = returnMatch[1].trim()
      if (returnVal && returnVal !== 'None') {
        // Handle tuple returns like "df, pd," or "(df, pd)"
        const cleanReturn = returnVal.replace(/^\(|\)$/g, '').replace(/,\s*$/, '')
        exports = cleanReturn
          .split(',')
          .map(e => e.trim())
          .filter(e => e.length > 0 && e !== 'None')
        if (exports.length === 0) {
          exports = undefined
        }
      }
    }

    // Check for hidden/disabled decorators
    const decoratorLine = content.slice(Math.max(0, match.index - 100), match.index)
    const hidden = /hide_code\s*=\s*True/.test(decoratorLine) || /@app\.cell\(hide_code\s*=\s*True\)/.test(match[0])
    const disabled = /disabled\s*=\s*True/.test(decoratorLine)

    // Remove return statement and leading/trailing whitespace from body
    // Handle both "return" and "return var," patterns
    body = body.replace(/\n?\s*return\s*(?:[^#\n]+)?(?:,\s*)?(?:\n|$)/g, '').trim()

    // Remove common indentation
    const lines = body.split('\n')
    if (lines.length > 0) {
      const firstLine = lines.find(l => l.trim().length > 0)
      if (firstLine) {
        const indentMatch = /^(\s*)/.exec(firstLine)
        const indent = indentMatch?.[1] || ''
        body = lines.map(l => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n')
      }
    }

    // Check if it's a markdown cell (uses mo.md())
    const isMarkdown = /^\s*mo\.md\s*\(/.test(body) || /^\s*marimo\.md\s*\(/.test(body)

    if (isMarkdown) {
      // Extract markdown content from mo.md() call
      const mdMatch =
        /(?:mo|marimo)\.md\s*\(\s*(?:r?(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)'''|"([^"]*)"|'([^']*)'))\s*\)/.exec(body)
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
  const idGenerator = options?.idGenerator ?? v4
  return app.cells.map((cell, index) => convertCellToBlock(cell, index, idGenerator))
}

/**
 * Converts Marimo app objects into a Deepnote project file.
 * This is a pure conversion function that doesn't perform any file I/O.
 *
 * @param apps - Array of Marimo apps with filenames
 * @param options - Conversion options including project name
 * @returns A DeepnoteFile object
 */
export function convertMarimoAppsToDeepnote(apps: MarimoAppInput[], options: { projectName: string }): DeepnoteFile {
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

  for (const { filename, app } of apps) {
    const extension = extname(filename)
    const filenameWithoutExt = basename(filename, extension) || 'Untitled notebook'

    // Use app title if available, otherwise use filename
    const notebookName = app.title || filenameWithoutExt

    const blocks = convertMarimoAppToBlocks(app)

    deepnoteFile.project.notebooks.push({
      blocks,
      executionMode: 'block',
      id: v4(),
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
    const content = await fs.readFile(filePath, 'utf-8')
    const app = parseMarimoFormat(content)
    apps.push({
      filename: basename(filePath),
      app,
    })
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
  const blockType = cell.cellType === 'markdown' ? 'markdown' : 'code'

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

  return {
    blockGroup: idGenerator(),
    content: cell.content,
    id: idGenerator(),
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
    sortingKey: createSortingKey(index),
    type: blockType,
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
