import type { DeepnoteBlock, DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { addContentHashes, computeSnapshotHash } from './hash'
import type { SplitResult } from './types'

/** Block types that can have outputs */
const EXECUTABLE_BLOCK_TYPES = new Set([
  'code',
  'sql',
  'notebook-function',
  'visualization',
  'button',
  'big-number',
  'input-text',
  'input-textarea',
  'input-checkbox',
  'input-select',
  'input-slider',
  'input-date',
  'input-date-range',
  'input-file',
])

/**
 * Checks if a block type can have outputs
 */
function isExecutableBlock(type: string): boolean {
  return EXECUTABLE_BLOCK_TYPES.has(type)
}

/**
 * Creates a slug from a project name.
 * Converts to lowercase, replaces spaces and special chars with hyphens,
 * removes consecutive hyphens, and trims leading/trailing hyphens.
 *
 * @param name - The project name to slugify
 * @returns A URL-safe slug
 */
export function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Generates a snapshot filename from project info.
 *
 * @param slug - The project name slug
 * @param projectId - The project UUID
 * @param timestamp - Timestamp string or 'latest'
 * @returns Filename in format '{slug}_{projectId}_{timestamp}.snapshot.deepnote'
 */
export function generateSnapshotFilename(slug: string, projectId: string, timestamp: string = 'latest'): string {
  return `${slug}_${projectId}_${timestamp}.snapshot.deepnote`
}

/**
 * Removes output-related fields from a block, returning a clean source block.
 */
function stripOutputsFromBlock(block: DeepnoteBlock): DeepnoteBlock {
  if (!isExecutableBlock(block.type)) {
    return block
  }

  // Create a copy without output fields
  const {
    executionCount: _executionCount,
    executionStartedAt: _executionStartedAt,
    executionFinishedAt: _executionFinishedAt,
    outputs: _outputs,
    ...rest
  } = block as DeepnoteBlock & {
    executionCount?: number | null
    executionStartedAt?: string
    executionFinishedAt?: string
    outputs?: unknown[]
  }

  // Suppress unused variable warnings
  void _executionCount
  void _executionStartedAt
  void _executionFinishedAt
  void _outputs

  return rest as DeepnoteBlock
}

/**
 * Splits a DeepnoteFile into a source file (no outputs) and a snapshot file (outputs only).
 *
 * @param file - The complete DeepnoteFile with outputs
 * @returns Object containing source and snapshot files
 */
export function splitDeepnoteFile(file: DeepnoteFile): SplitResult {
  // First ensure all blocks have content hashes (returns new file, doesn't mutate)
  const fileWithHashes = addContentHashes(file)

  // Compute snapshot hash before stripping outputs
  const snapshotHash = computeSnapshotHash(fileWithHashes)

  // Create source file with outputs stripped
  const source: DeepnoteFile = {
    ...fileWithHashes,
    project: {
      ...fileWithHashes.project,
      notebooks: fileWithHashes.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map(stripOutputsFromBlock),
      })),
    },
  }

  // Create snapshot file with all data plus snapshot metadata
  const snapshot: DeepnoteSnapshot = {
    ...fileWithHashes,
    environment: fileWithHashes.environment ?? {},
    execution: fileWithHashes.execution ?? {},
    metadata: {
      ...fileWithHashes.metadata,
      snapshotHash,
    },
  }

  return { source, snapshot }
}

/**
 * Checks if a DeepnoteFile has any outputs.
 *
 * @param file - The DeepnoteFile to check
 * @returns True if any block has outputs
 */
export function hasOutputs(file: DeepnoteFile): boolean {
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      const execBlock = block as DeepnoteBlock & { outputs?: unknown[] }
      if (execBlock.outputs && execBlock.outputs.length > 0) {
        return true
      }
    }
  }
  return false
}
