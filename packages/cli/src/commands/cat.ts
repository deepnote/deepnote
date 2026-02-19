import fs from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import { codeToANSI } from '@shikijs/cli'
import type { ChalkInstance } from 'chalk'
import { type Command, InvalidArgumentError } from 'commander'
import wrapAnsi from 'wrap-ansi'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, getOutputConfig, error as logError, type OutputFormat, output, outputJson } from '../output'
import { getBlockLabel } from '../utils/block-label'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

/** Maximum width for text content in markdown and text blocks. */
const TEXT_BLOCK_MAX_WIDTH = 100

/**
 * Block types that can be used with the --type filter in the cat command.
 * These include both direct type matches and category filters.
 */
export const FILTERABLE_BLOCK_TYPES = ['code', 'sql', 'markdown', 'text', 'input'] as const
export type FilterableBlockType = (typeof FILTERABLE_BLOCK_TYPES)[number]

/**
 * Creates a validator function for the --type option.
 * @returns Validator function for Commander option parsing
 */
export function createBlockTypeValidator(): (value: string) => FilterableBlockType {
  return (value: string): FilterableBlockType => {
    if (!FILTERABLE_BLOCK_TYPES.includes(value as FilterableBlockType)) {
      throw new InvalidArgumentError(`Invalid block type "${value}". Valid types: ${FILTERABLE_BLOCK_TYPES.join(', ')}`)
    }
    return value as FilterableBlockType
  }
}

export interface CatOptions {
  output?: OutputFormat
  notebook?: string
  type?: FilterableBlockType
  tree?: boolean
}

export function createCatAction(_program: Command): (path: string, options: CatOptions) => Promise<void> {
  return async (path, options) => {
    try {
      debug(`Cat file: ${path}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await catDeepnoteFile(path, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // User input errors should return InvalidUsage (2)
      const exitCode =
        error instanceof FileResolutionError ||
        message.includes('not found') ||
        message.includes('Notebook ') ||
        message.includes('Failed to parse') ||
        message.includes('Invalid YAML')
          ? ExitCode.InvalidUsage
          : ExitCode.Error
      if (options.output === 'json') {
        outputJson({ success: false, error: message })
      } else {
        logError(message)
      }
      process.exit(exitCode)
    }
  }
}

async function catDeepnoteFile(path: string, options: CatOptions): Promise<void> {
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
      throw new Error(`Notebook "${options.notebook}" not found in project`)
    }
  }

  if (options.output === 'json') {
    outputCatJson(absolutePath, deepnoteFile, notebooks, options)
  } else {
    await printBlocks(absolutePath, notebooks, options)
  }
}

type BlockSummary = Pick<DeepnoteBlock, 'id' | 'type'> & { label: string; content?: string }
type NotebookSummary = Pick<DeepnoteFile['project']['notebooks'][number], 'name' | 'id'> & { blocks: BlockSummary[] }

/** JSON output result for the cat command */
export interface CatResult {
  success: boolean
  path: string
  project: Pick<DeepnoteFile['project'], 'name' | 'id'>
  notebooks: NotebookSummary[]
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
  const result: CatResult = {
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
    const notebookResult: NotebookSummary = {
      name: notebook.name,
      id: notebook.id,
      blocks: [],
    }

    for (const block of filteredBlocks) {
      const blockResult: BlockSummary = {
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
  const chalk = getChalk()
  output(chalk.dim(`File: ${absolutePath}`))
  output('')

  for (let i = 0; i < notebooks.length; i++) {
    const notebook = notebooks[i]
    const filteredBlocks = filterBlocks(notebook.blocks, options)

    // Add divider between notebooks (not before the first one)
    if (i > 0) {
      output('')
      output(chalk.cyan('═'.repeat(60)))
      output('')
    }

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
  const chalk = getChalk()
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
    let content = getBlockContent(block)
    if (content) {
      output('')
      if (block.type === 'markdown' || block.type.startsWith('text-cell-')) {
        content = wrapAnsi(content, TEXT_BLOCK_MAX_WIDTH, { hard: true })
      }
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
    return blocks.filter(b => b.type.startsWith('text-cell-'))
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
function getTypeColor(type: DeepnoteBlock['type']): ChalkInstance {
  const chalk = getChalk()
  if (type === 'code') return chalk.yellow
  if (type === 'sql') return chalk.blue
  if (type === 'markdown' || type.startsWith('text-cell-')) return chalk.green
  if (type.startsWith('input-')) return chalk.magenta
  return chalk.white
}

/**
 * Apply syntax highlighting to content based on block type using Shiki.
 * Only applies highlighting when color output is enabled.
 */
async function highlightContent(content: string, type: DeepnoteBlock['type']): Promise<string> {
  const { color } = getOutputConfig()

  if (color) {
    if (type === 'code') {
      return codeToANSI(content, 'python', 'catppuccin-macchiato')
    }
    if (type === 'sql') {
      return codeToANSI(content, 'sql', 'catppuccin-macchiato')
    }
  }

  return content
}
