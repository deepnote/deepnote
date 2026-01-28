import fs from 'node:fs/promises'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import type { ChalkInstance } from 'chalk'
import type { Command } from 'commander'
import { diffLines } from 'diff'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output, outputJson } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface DiffOptions {
  output?: 'json'
  content?: boolean
}

interface NotebookDiff {
  name: string
  oldName?: string // Present when notebook was renamed
  id: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  blockCount?: number
  blockDiffs?: BlockDiff[]
}

interface BlockDiff {
  id: string
  type: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  contentDiff?: {
    before: string | undefined
    after: string | undefined
  }
}

type ChangedNotebookDiff = NotebookDiff & { status: 'added' | 'removed' | 'modified' }
type ChangedBlockDiff = BlockDiff & { status: 'added' | 'removed' | 'modified' }

function isChangedBlock(block: BlockDiff): block is ChangedBlockDiff {
  return block.status !== 'unchanged'
}

interface DiffResult {
  file1: string
  file2: string
  notebooks: NotebookDiff[]
  summary: {
    notebooksAdded: number
    notebooksRemoved: number
    notebooksModified: number
    notebooksUnchanged: number
    blocksAdded: number
    blocksRemoved: number
    blocksModified: number
    blocksUnchanged: number
  }
}

export function createDiffAction(
  _program: Command
): (path1: string | undefined, path2: string | undefined, options: DiffOptions) => Promise<void> {
  return async (path1, path2, options) => {
    try {
      debug(`Diffing files: ${path1} vs ${path2}`)
      debug(`Options: ${JSON.stringify(options)}`)
      await diffDeepnoteFiles(path1, path2, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      switch (options.output) {
        case 'json':
          outputJson({ success: false, error: message })
          break
        case undefined:
          logError(message)
          break
      }
      process.exit(exitCode)
    }
  }
}

async function diffDeepnoteFiles(
  path1: string | undefined,
  path2: string | undefined,
  options: DiffOptions
): Promise<void> {
  const { absolutePath: absolutePath1 } = await resolvePathToDeepnoteFile(path1)
  const { absolutePath: absolutePath2 } = await resolvePathToDeepnoteFile(path2)

  debug('Reading file 1...')
  const rawBytes1 = await fs.readFile(absolutePath1)
  const yamlContent1 = decodeUtf8NoBom(rawBytes1)
  const file1 = deserializeDeepnoteFile(yamlContent1)

  debug('Reading file 2...')
  const rawBytes2 = await fs.readFile(absolutePath2)
  const yamlContent2 = decodeUtf8NoBom(rawBytes2)
  const file2 = deserializeDeepnoteFile(yamlContent2)

  const diffResult = computeDiff(absolutePath1, absolutePath2, file1, file2, options)

  switch (options.output) {
    case 'json':
      outputDiffJson(diffResult)
      break
    case undefined:
      printDiff(diffResult, options)
      break
  }
}

/**
 * Compute the structural diff between two .deepnote files.
 */
function computeDiff(
  path1: string,
  path2: string,
  file1: DeepnoteFile,
  file2: DeepnoteFile,
  options: DiffOptions
): DiffResult {
  const notebooks1 = new Map(file1.project.notebooks.map(nb => [nb.id, nb]))
  const notebooks2 = new Map(file2.project.notebooks.map(nb => [nb.id, nb]))

  const notebookDiffs: NotebookDiff[] = []
  const summary = {
    notebooksAdded: 0,
    notebooksRemoved: 0,
    notebooksModified: 0,
    notebooksUnchanged: 0,
    blocksAdded: 0,
    blocksRemoved: 0,
    blocksModified: 0,
    blocksUnchanged: 0,
  }

  // Find removed and modified notebooks
  for (const [id, nb1] of notebooks1) {
    const nb2 = notebooks2.get(id)
    if (!nb2) {
      // Notebook removed
      notebookDiffs.push({
        name: nb1.name,
        id,
        status: 'removed',
        blockCount: nb1.blocks.length,
      })
      summary.notebooksRemoved++
      summary.blocksRemoved += nb1.blocks.length
    } else {
      // Notebook exists in both - compare blocks and name
      const blockDiffs = computeBlockDiffs(nb1.blocks, nb2.blocks, options)
      const hasBlockChanges = blockDiffs.some(bd => bd.status !== 'unchanged')
      const wasRenamed = nb1.name !== nb2.name
      const hasChanges = hasBlockChanges || wasRenamed

      if (hasChanges) {
        notebookDiffs.push({
          name: nb2.name,
          ...(wasRenamed && { oldName: nb1.name }),
          id,
          status: 'modified',
          blockDiffs: blockDiffs.filter(bd => bd.status !== 'unchanged'),
        })
        summary.notebooksModified++
      } else {
        notebookDiffs.push({
          name: nb2.name,
          id,
          status: 'unchanged',
        })
        summary.notebooksUnchanged++
      }

      // Count block changes
      for (const bd of blockDiffs) {
        if (bd.status === 'added') summary.blocksAdded++
        else if (bd.status === 'removed') summary.blocksRemoved++
        else if (bd.status === 'modified') summary.blocksModified++
        else summary.blocksUnchanged++
      }
    }
  }

  // Find added notebooks
  for (const [id, nb2] of notebooks2) {
    if (!notebooks1.has(id)) {
      notebookDiffs.push({
        name: nb2.name,
        id,
        status: 'added',
        blockCount: nb2.blocks.length,
      })
      summary.notebooksAdded++
      summary.blocksAdded += nb2.blocks.length
    }
  }

  // Sort by status: added, removed, modified, unchanged
  const statusOrder = { added: 0, removed: 1, modified: 2, unchanged: 3 }
  notebookDiffs.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  return {
    file1: path1,
    file2: path2,
    notebooks: notebookDiffs,
    summary,
  }
}

/**
 * Compare blocks between two notebooks.
 */
function computeBlockDiffs(blocks1: DeepnoteBlock[], blocks2: DeepnoteBlock[], options: DiffOptions): BlockDiff[] {
  const blocksMap1 = new Map(blocks1.map(b => [b.id, b]))
  const blocksMap2 = new Map(blocks2.map(b => [b.id, b]))

  const blockDiffs: BlockDiff[] = []

  // Find removed and modified blocks
  for (const [id, block1] of blocksMap1) {
    const block2 = blocksMap2.get(id)
    if (!block2) {
      blockDiffs.push({
        id,
        type: block1.type,
        status: 'removed',
        ...(options.content && {
          contentDiff: {
            before: getBlockContent(block1),
            after: undefined,
          },
        }),
      })
    } else {
      const content1 = getBlockContent(block1)
      const content2 = getBlockContent(block2)
      const typeChanged = block1.type !== block2.type
      const contentChanged = content1 !== content2

      if (typeChanged || contentChanged) {
        blockDiffs.push({
          id,
          type: block2.type,
          status: 'modified',
          ...(options.content && {
            contentDiff: {
              before: content1,
              after: content2,
            },
          }),
        })
      } else {
        blockDiffs.push({
          id,
          type: block2.type,
          status: 'unchanged',
        })
      }
    }
  }

  // Find added blocks
  for (const [id, block2] of blocksMap2) {
    if (!blocksMap1.has(id)) {
      blockDiffs.push({
        id,
        type: block2.type,
        status: 'added',
        ...(options.content && {
          contentDiff: {
            before: undefined,
            after: getBlockContent(block2),
          },
        }),
      })
    }
  }

  return blockDiffs
}

/**
 * Get the content of a block for comparison.
 */
function getBlockContent(block: DeepnoteBlock): string | undefined {
  if ('content' in block && typeof block.content === 'string') {
    return block.content
  }
  return undefined
}

/**
 * Output diff as JSON.
 */
function outputDiffJson(result: DiffResult): void {
  outputJson({
    success: true,
    ...result,
  })
}

/**
 * Print diff in human-readable format.
 */
function printDiff(result: DiffResult, options: DiffOptions): void {
  const c = getChalk()
  output(c.bold(`Comparing: ${result.file1}`))
  output(c.bold(`     with: ${result.file2}`))
  output('')

  const hasChanges =
    result.summary.notebooksAdded > 0 || result.summary.notebooksRemoved > 0 || result.summary.notebooksModified > 0

  if (!hasChanges) {
    output(c.green('No structural differences found.'))
    return
  }

  output(c.bold('Notebooks:'))

  const changedNotebooks = result.notebooks.filter((nb): nb is ChangedNotebookDiff => nb.status !== 'unchanged')

  for (const nb of changedNotebooks) {
    const statusIcon = getStatusIcon(nb.status)
    const statusColor = getStatusColor(nb.status, c)

    if (nb.status === 'added') {
      output(statusColor(`  ${statusIcon} Added: "${nb.name}" (${nb.blockCount} blocks)`))
    } else if (nb.status === 'removed') {
      output(statusColor(`  ${statusIcon} Removed: "${nb.name}" (${nb.blockCount} blocks)`))
    } else if (nb.status === 'modified') {
      if (nb.oldName) {
        output(statusColor(`  ${statusIcon} Renamed: "${nb.oldName}" → "${nb.name}"`))
      } else {
        output(statusColor(`  ${statusIcon} Modified: "${nb.name}"`))
      }

      for (const bd of (nb.blockDiffs ?? []).filter(isChangedBlock)) {
        const blockStatusIcon = getStatusIcon(bd.status)
        const blockStatusColor = getStatusColor(bd.status, c)
        output(blockStatusColor(`      ${blockStatusIcon} ${bd.type} (${bd.id})`))

        if (options.content && bd.contentDiff) {
          printContentDiff(bd.contentDiff.before, bd.contentDiff.after, c)
        }
      }
    }
  }

  output('')
  output(c.bold('Summary:'))
  if (result.summary.notebooksAdded > 0) {
    output(c.green(`  + ${result.summary.notebooksAdded} notebook(s) added`))
  }
  if (result.summary.notebooksRemoved > 0) {
    output(c.red(`  - ${result.summary.notebooksRemoved} notebook(s) removed`))
  }
  if (result.summary.notebooksModified > 0) {
    output(c.yellow(`  ~ ${result.summary.notebooksModified} notebook(s) modified`))
  }
  if (result.summary.blocksAdded > 0) {
    output(c.green(`  + ${result.summary.blocksAdded} block(s) added`))
  }
  if (result.summary.blocksRemoved > 0) {
    output(c.red(`  - ${result.summary.blocksRemoved} block(s) removed`))
  }
  if (result.summary.blocksModified > 0) {
    output(c.yellow(`  ~ ${result.summary.blocksModified} block(s) modified`))
  }
}

/**
 * Print content diff with line-by-line changes.
 */
function printContentDiff(before: string | undefined, after: string | undefined, c: ChalkInstance): void {
  const oldContent = before ?? ''
  const newContent = after ?? ''

  const changes = diffLines(oldContent, newContent)

  for (const change of changes) {
    // Split into lines and remove trailing empty line from the split
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (const line of lines) {
      if (change.added) {
        output(c.green(`        + ${line}`))
      } else if (change.removed) {
        output(c.red(`        - ${line}`))
      } else {
        output(c.gray(`          ${line}`))
      }
    }
  }
}

function getStatusIcon(status: 'added' | 'removed' | 'modified'): string {
  if (status === 'added') return '+'
  if (status === 'removed') return '-'
  return '~'
}

function getStatusColor(status: 'added' | 'removed' | 'modified', c: ChalkInstance): ChalkInstance {
  if (status === 'added') return c.green
  if (status === 'removed') return c.red
  return c.yellow
}
