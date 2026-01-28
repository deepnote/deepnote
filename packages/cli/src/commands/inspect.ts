import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, type OutputFormat, output, outputJson, outputToon } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface InspectOptions {
  output?: OutputFormat
}

export function createInspectAction(
  _program: Command
): (path: string | undefined, options: InspectOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Inspecting file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await inspectDeepnoteFile(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Use InvalidUsage for file resolution errors (user input), Error for runtime failures
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else if (options.output === 'toon') {
        outputToon({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(exitCode)
    }
  }
}

async function inspectDeepnoteFile(path: string | undefined, options: InspectOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  if (options.output === 'json') {
    outputInspectJson(absolutePath, deepnoteFile)
  } else if (options.output === 'toon') {
    outputInspectToon(absolutePath, deepnoteFile)
  } else {
    printDeepnoteFileMetadata(absolutePath, deepnoteFile)
  }
}

/**
 * Build inspect result data structure for machine-readable output.
 */
function buildInspectResult(absolutePath: string, deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>) {
  const { project, metadata, version: fileVersion } = deepnoteFile
  const notebooks = project.notebooks
  const totalBlocks = notebooks.reduce((sum, notebook) => sum + notebook.blocks.length, 0)

  return {
    success: true,
    path: absolutePath,
    project: {
      name: project.name,
      id: project.id,
    },
    version: fileVersion,
    metadata: {
      createdAt: metadata.createdAt,
      modifiedAt: metadata.modifiedAt ?? null,
      exportedAt: metadata.exportedAt ?? null,
    },
    statistics: {
      notebookCount: notebooks.length,
      totalBlocks,
    },
    notebooks: notebooks.map(notebook => ({
      name: notebook.name,
      blockCount: notebook.blocks.length,
      isModule: notebook.isModule ?? false,
    })),
  }
}

/**
 * Output inspect results as JSON for scripting.
 */
function outputInspectJson(absolutePath: string, deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>): void {
  outputJson(buildInspectResult(absolutePath, deepnoteFile))
}

/**
 * Output inspect results as TOON (Token-Oriented Object Notation).
 * TOON is optimized for LLM consumption with reduced token usage.
 */
function outputInspectToon(absolutePath: string, deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>): void {
  outputToon(buildInspectResult(absolutePath, deepnoteFile), { showEfficiencyHint: true })
}

function printDeepnoteFileMetadata(
  absolutePath: string,
  deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>
): void {
  const { project, metadata, version: fileVersion } = deepnoteFile
  const notebooks = project.notebooks
  const totalBlocks = notebooks.reduce((sum, notebook) => sum + notebook.blocks.length, 0)
  const c = getChalk()

  output(`${c.dim('Path:')} ${absolutePath}`)
  output(`${c.dim('Name:')} ${project.name}`)
  output(`${c.dim('Project ID:')} ${project.id}`)
  output(`${c.dim('Version:')} ${fileVersion}`)
  output(`${c.dim('Created:')} ${metadata.createdAt}`)

  if (metadata.modifiedAt) {
    output(`${c.dim('Modified:')} ${metadata.modifiedAt}`)
  }

  if (metadata.exportedAt) {
    output(`${c.dim('Exported:')} ${metadata.exportedAt}`)
  }

  output(`${c.dim('Notebooks count:')} ${notebooks.length}`)
  output(`${c.dim('Blocks:')} ${totalBlocks}`)

  if (notebooks.length > 0) {
    output(`${c.dim('Notebooks:')}`)
    for (const notebook of notebooks) {
      const moduleSuffix = notebook.isModule ? ', module' : ''
      output(`- ${notebook.name} (${notebook.blocks.length} blocks${moduleSuffix})`)
    }
  }
}
