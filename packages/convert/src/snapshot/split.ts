import type { DeepnoteBlock, DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { isExecutableBlockType } from '@deepnote/blocks'
import { addContentHashes, computeSnapshotHash } from './hash'
import type { SplitResult } from './types'

/**
 * Creates a slug from a project name.
 * Normalizes accented characters to ASCII equivalents (e.g., é → e),
 * converts to lowercase, replaces spaces and special chars with hyphens,
 * removes consecutive hyphens, and trims leading/trailing hyphens.
 *
 * @param name - The project name to slugify
 * @returns A URL-safe slug
 */
export function slugifyProjectName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
export function generateSnapshotFilename(
  slug: string,
  projectId: string,
  notebookId?: string,
  timestamp: string = 'latest'
): string {
  if (notebookId) {
    return `${slug}_${projectId}_${notebookId}_${timestamp}.snapshot.deepnote`
  }
  return `${slug}_${projectId}_${timestamp}.snapshot.deepnote`
}

/**
 * Removes output-related fields from a block, returning a clean source block.
 */
function stripOutputsFromBlock(block: DeepnoteBlock): DeepnoteBlock {
  if (!isExecutableBlockType(block.type)) {
    return block
  }

  // Create a copy without output fields (underscore prefix suppresses unused warnings)
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

  // Create source file with outputs stripped (exclude snapshotHash from source)
  const { snapshotHash: _snapshotHash, ...sourceMetadata } = (fileWithHashes.metadata ?? {}) as NonNullable<
    typeof fileWithHashes.metadata
  > & {
    snapshotHash?: string
  }
  const source: DeepnoteFile = {
    ...fileWithHashes,
    metadata: sourceMetadata,
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
      if (!isExecutableBlockType(block.type)) {
        continue
      }
      const execBlock = block as DeepnoteBlock & { outputs?: unknown[] }
      if (execBlock.outputs && execBlock.outputs.length > 0) {
        return true
      }
    }
  }
  return false
}

/**
 * Splits a multi-notebook DeepnoteFile into separate single-notebook files.
 * Each result shares the same project metadata but contains only one notebook.
 *
 * @param file - The DeepnoteFile to split
 * @returns Array of objects with notebook info and the single-notebook file
 */
export function splitByNotebooks(
  file: DeepnoteFile
): Array<{ notebook: { id: string; name: string }; file: DeepnoteFile }> {
  if (file.project.notebooks.length === 0) {
    return []
  }
  if (file.project.notebooks.length === 1) {
    const nb = file.project.notebooks[0]
    return [{ notebook: { id: nb.id, name: nb.name }, file }]
  }
  return file.project.notebooks.map(notebook => ({
    notebook: { id: notebook.id, name: notebook.name },
    file: {
      ...file,
      project: {
        ...file.project,
        notebooks: [notebook],
      },
    },
  }))
}

/**
 * Generates the output filename for a split notebook file.
 *
 * @param sourceFileStem - The original filename without extension (e.g., "foo")
 * @param notebookName - The notebook name (e.g., "Dashboard")
 * @returns Filename like "foo-dashboard.deepnote"
 */
export function generateSplitFilename(sourceFileStem: string, notebookName: string): string {
  const notebookSlug = slugifyProjectName(notebookName)
  return `${sourceFileStem}-${notebookSlug}.deepnote`
}

/**
 * Splits a multi-notebook snapshot into separate per-notebook snapshots.
 *
 * @param snapshot - The snapshot to split
 * @param notebookIds - The notebook IDs to extract
 * @returns Map from notebookId to the per-notebook snapshot
 */
export function splitSnapshotByNotebooks(
  snapshot: DeepnoteSnapshot,
  notebookIds: string[]
): Map<string, DeepnoteSnapshot> {
  const result = new Map<string, DeepnoteSnapshot>()
  for (const nbId of notebookIds) {
    const notebook = snapshot.project.notebooks.find(nb => nb.id === nbId)
    if (notebook) {
      result.set(nbId, {
        ...snapshot,
        project: {
          ...snapshot.project,
          notebooks: [notebook],
        },
      })
    }
  }
  return result
}
