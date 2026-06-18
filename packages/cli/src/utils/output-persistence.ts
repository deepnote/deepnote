import type { DeepnoteFile } from '@deepnote/blocks'
import { type ExecutionTiming, saveExecutionSnapshot as saveExecutionSnapshotShared } from '@deepnote/convert'
import type { IOutput } from '@deepnote/runtime-core'
import { debug } from '../output'

/**
 * Result of a single block execution (subset of BlockResult from run.ts)
 */
export interface BlockExecutionOutput {
  id: string
  outputs: IOutput[]
  executionCount?: number | null
}

/**
 * Result of saving a snapshot.
 */
export interface SaveSnapshotResult {
  snapshotPath: string
  timestampedSnapshotPath: string
}

/**
 * Saves execution outputs to a snapshot file.
 *
 * Thin CLI wrapper around the shared `saveExecutionSnapshot` that reproduces
 * the CLI's debug logging and returns the legacy result shape.
 *
 * @param sourcePath - Path to the original source file (or where it would be if converted)
 * @param file - The DeepnoteFile (original, without outputs)
 * @param blockOutputs - Outputs from executed blocks
 * @param timing - Execution start and end times
 * @returns The path to the saved snapshot file
 */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: BlockExecutionOutput[],
  timing: ExecutionTiming
): Promise<SaveSnapshotResult> {
  const result = await saveExecutionSnapshotShared(sourcePath, file, blockOutputs, timing)

  debug(`Saved execution snapshot to: ${result.timestampedSnapshotPath}`)
  debug(`Updated latest snapshot: ${result.snapshotPath}`)

  return result
}
