import fs from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { codeToANSI } from '@shikijs/cli'
import chalk, { type ChalkInstance } from 'chalk'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, error as logError, output, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface CatOptions {
  json?: boolean
  notebook?: string
  type?: string
  tree?: boolean
}

export function createCatAction(_program: Command): (path: string | undefined, options: CatOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Cat file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await catDeepnoteFile(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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

async function catDeepnoteFile(path: string | undefined, options: CatOptions): Promise<void> {
  const { absolutePath } = await resolvePathToDeepnoteFile(path)

  debug('Reading file contents...')
  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)

  debug('Parsing .deepnote file...')
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  // Filter notebooks if --notebook option is provided
  let notebooks = deepnoteFile.project.notebooks
  if (options.notebook) {
    notebooks = notebooks.filter(nb => nb.name === options.notebook)
    if (notebooks.length === 0) {
      throw new FileResolutionError(`Notebook not found: ${options.notebook}`)
    }
  }

  if (options.json) {
    outputCatJson(absolutePath, deepnoteFile, notebooks, options)
  } else {
    await printBlocks(absolutePath, notebooks, options)
  }
}

/**
 * Output cat results as JSON for scripting.
 */
function outputCatJson(
  absolutePath: string,
  deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>,
  notebooks: DeepnoteFile['project']['notebooks'],
  options: CatOptions
): void {
  const result: {
    success: boolean
    path: string
    project: { name: string; id: string }
    notebooks: Array<{
      name: string
      id: string
      blocks: Array<{
        id: string
        type: string
        label: string
        content?: string
      }>
    }>
  } = {
    success: true,
    path: absolutePath,
    project: {
      name: deepnoteFile.project.name,
      id: deepnoteFile.project.id,
    },
    notebooks: [],
  }

  for (const notebook of notebooks) {
    const filteredBlocks = filterBlocks(notebook.blocks, options)
    const notebookResult: (typeof result.notebooks)[number] = {
      name: notebook.name,
      id: notebook.id,
      blocks: [],
    }

    for (const block of filteredBlocks) {
      const blockResult: (typeof notebookResult.blocks)[number] = {
        id: block.id,
        type: block.type,
        label: getBlockLabel(block),
      }

      // Include content unless --tree mode
      if (!options.tree) {
        const content = getBlockContent(block)
        if (content !== undefined) {
          blockResult.content = content
        }
      }

      notebookResult.blocks.push(blockResult)
    }

    result.notebooks.push(notebookResult)
  }

  outputJson(result)
}

/**
 * Print blocks to stdout with formatting.
 */
async function printBlocks(
  absolutePath: string,
  notebooks: DeepnoteFile['project']['notebooks'],
  options: CatOptions
): Promise<void> {
  output(chalk.dim(`File: ${absolutePath}`))
  output('')

  for (const notebook of notebooks) {
    const filteredBlocks = filterBlocks(notebook.blocks, options)

    output(chalk.bold.cyan(`Notebook: ${notebook.name}`))
    output(chalk.dim(`  ID: ${notebook.id}`))
    output(chalk.dim(`  Blocks: ${filteredBlocks.length}`))
    output('')

    for (const block of filteredBlocks) {
      await printBlock(block, options)
    }
  }
}

/**
 * Print a single block with formatting.
 */
async function printBlock(block: DeepnoteBlock, options: CatOptions): Promise<void> {
  const typeColor = getTypeColor(block.type)

  output(`${chalk.dim('─'.repeat(60))}`)
  output(`${typeColor(block.type)} ${chalk.dim(`(${block.id})`)}`)

  // Show label for input blocks
  if (block.type.startsWith('input-')) {
    const metadata = block.metadata as { deepnote_variable_name?: string } | undefined
    if (metadata?.deepnote_variable_name) {
      output(chalk.dim(`  Variable: ${metadata.deepnote_variable_name}`))
    }
  }

  // Show content unless --tree mode
  if (!options.tree) {
    const content = getBlockContent(block)
    if (content) {
      output('')
      const highlighted = await highlightContent(content, block.type)
      // Indent each line
      const lines = highlighted.split('\n')
      for (const line of lines) {
        output(`  ${line}`)
      }
    } else if (content === '') {
      output(chalk.dim('  (empty)'))
    }
  }

  output('')
}

/**
 * Filter blocks by type if --type option is provided.
 */
function filterBlocks(blocks: DeepnoteBlock[], options: CatOptions): DeepnoteBlock[] {
  if (!options.type) {
    return blocks
  }

  const typeFilter = options.type.toLowerCase()

  // Handle category filters
  if (typeFilter === 'text') {
    return blocks.filter(b => b.type.startsWith('text-cell-') || b.type === 'markdown')
  }
  if (typeFilter === 'input') {
    return blocks.filter(b => b.type.startsWith('input-'))
  }

  return blocks.filter(b => b.type === typeFilter)
}

/**
 * Get the content of a block.
 */
function getBlockContent(block: DeepnoteBlock): string | undefined {
  // Blocks with direct content
  if ('content' in block && typeof block.content === 'string') {
    return block.content
  }

  // Separator blocks show a horizontal line
  if (block.type === 'separator') {
    return '---'
  }

  return undefined
}

/**
 * Get color function for block type.
 */
function getTypeColor(type: string): ChalkInstance {
  if (type === 'code') return chalk.yellow
  if (type === 'sql') return chalk.blue
  if (type === 'markdown' || type.startsWith('text-cell-')) return chalk.green
  if (type.startsWith('input-')) return chalk.magenta
  return chalk.white
}

/**
 * Apply syntax highlighting to content based on block type using Shiki.
 */
async function highlightContent(content: string, type: string): Promise<string> {
  if (type === 'code') {
    return codeToANSI(content, 'python', 'nord')
  }
  if (type === 'sql') {
    return codeToANSI(content, 'sql', 'nord')
  }
  return content
}
