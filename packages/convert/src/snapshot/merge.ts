import type { DeepnoteBlock, DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import type { MergeOptions } from './types'

/**
 * Merges outputs from a snapshot into a source file.
 * Returns a new DeepnoteFile with outputs added from the snapshot.
 *
 * @param source - The source DeepnoteFile (without outputs)
 * @param snapshot - The snapshot containing outputs
 * @param options - Merge options
 * @returns A new DeepnoteFile with outputs merged in
 */
export function mergeSnapshotIntoSource(
  source: DeepnoteFile,
  snapshot: DeepnoteSnapshot,
  options: MergeOptions = {}
): DeepnoteFile {
  const { skipMismatched = false } = options

  // Build a map of block outputs from snapshot: blockId -> block with outputs
  const outputMap = new Map<
    string,
    {
      contentHash?: string
      executionCount?: number | null
      executionStartedAt?: string
      executionFinishedAt?: string
      outputs?: unknown[]
    }
  >()

  for (const notebook of snapshot.project.notebooks) {
    for (const block of notebook.blocks) {
      const execBlock = block as DeepnoteBlock & {
        executionCount?: number | null
        executionStartedAt?: string
        executionFinishedAt?: string
        outputs?: unknown[]
      }

      // Only store blocks that have outputs
      if (execBlock.outputs && execBlock.outputs.length > 0) {
        outputMap.set(block.id, {
          contentHash: block.contentHash,
          executionCount: execBlock.executionCount,
          executionStartedAt: execBlock.executionStartedAt,
          executionFinishedAt: execBlock.executionFinishedAt,
          outputs: execBlock.outputs,
        })
      }
    }
  }

  // Merge snapshot environment and execution into source
  const merged: DeepnoteFile = {
    ...source,
    environment: snapshot.environment ?? source.environment,
    execution: snapshot.execution ?? source.execution,
    project: {
      ...source.project,
      notebooks: source.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map(block => {
          const snapshotData = outputMap.get(block.id)

          if (!snapshotData) {
            // No outputs for this block
            return block
          }

          // Check content hash match if skipMismatched is enabled
          if (skipMismatched && snapshotData.contentHash && block.contentHash) {
            if (snapshotData.contentHash !== block.contentHash) {
              // Content has changed, skip merging outputs
              return block
            }
          }

          // Merge outputs into block
          return {
            ...block,
            ...(snapshotData.executionCount !== undefined ? { executionCount: snapshotData.executionCount } : {}),
            ...(snapshotData.executionStartedAt ? { executionStartedAt: snapshotData.executionStartedAt } : {}),
            ...(snapshotData.executionFinishedAt ? { executionFinishedAt: snapshotData.executionFinishedAt } : {}),
            ...(snapshotData.outputs ? { outputs: snapshotData.outputs } : {}),
          } as DeepnoteBlock
        }),
      })),
    },
  }

  return merged
}

/**
 * Counts blocks with outputs in a file.
 *
 * @param file - The DeepnoteFile to count outputs in
 * @returns Number of blocks that have outputs
 */
export function countBlocksWithOutputs(file: DeepnoteFile): number {
  let count = 0
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      const execBlock = block as DeepnoteBlock & { outputs?: unknown[] }
      if (execBlock.outputs && execBlock.outputs.length > 0) {
        count++
      }
    }
  }
  return count
}
