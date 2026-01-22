import fs from 'node:fs/promises'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import chalk from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, output, outputJson } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface InspectOptions {
  json?: boolean
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
      if (options.json) {
        outputJson({ success: false, error: message })
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

  if (options.json) {
    outputInspectJson(absolutePath, deepnoteFile)
  } else {
    printDeepnoteFileMetadata(absolutePath, deepnoteFile)
  }
}

/**
 * Output inspect results as JSON for scripting.
 */
function outputInspectJson(absolutePath: string, deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>): void {
  const { project, metadata, version: fileVersion } = deepnoteFile
  const notebooks = project.notebooks
  const totalBlocks = notebooks.reduce((sum, notebook) => sum + notebook.blocks.length, 0)

  outputJson({
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
  })
}

function printDeepnoteFileMetadata(
  absolutePath: string,
  deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>
): void {
  const { project, metadata, version: fileVersion } = deepnoteFile
  const notebooks = project.notebooks
  const totalBlocks = notebooks.reduce((sum, notebook) => sum + notebook.blocks.length, 0)

  output(`${chalk.dim('Path:')} ${absolutePath}`)
  output(`${chalk.dim('Name:')} ${project.name}`)
  output(`${chalk.dim('Project ID:')} ${project.id}`)
  output(`${chalk.dim('Version:')} ${fileVersion}`)
  output(`${chalk.dim('Created:')} ${metadata.createdAt}`)

  if (metadata.modifiedAt) {
    output(`${chalk.dim('Modified:')} ${metadata.modifiedAt}`)
  }

  if (metadata.exportedAt) {
    output(`${chalk.dim('Exported:')} ${metadata.exportedAt}`)
  }

  output(`${chalk.dim('Notebooks count:')} ${notebooks.length}`)
  output(`${chalk.dim('Blocks:')} ${totalBlocks}`)

  if (notebooks.length > 0) {
    output(`${chalk.dim('Notebooks:')}`)
    for (const notebook of notebooks) {
      const moduleSuffix = notebook.isModule ? ', module' : ''
      output(`- ${notebook.name} (${notebook.blocks.length} blocks${moduleSuffix})`)
    }
  }
}
