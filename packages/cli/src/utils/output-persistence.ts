import type { DeepnoteFile } from '@deepnote/blocks'
import {
  type ExecutionTiming,
  type SaveExecutionSnapshotResult,
  saveExecutionSnapshot as saveExecutionSnapshotShared,
} from '@deepnote/convert'
import type { IOutput } from '@deepnote/runtime-core'
import { debug } from '../output'

/**
 * Result of a single block execution (subset of BlockResult from run.ts).
 *
 * Narrows the shared `BlockExecutionOutput.outputs` to runtime-core `IOutput` so CLI callers keep type-safety.
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
 * Thin CLI wrapper around the shared `saveExecutionSnapshot` that reproduces the
 * CLI's debug logging and returns the result shape.
 *
 * @param sourcePath - Path to the original source file (or where it would be if converted)
 * @param file - The DeepnoteFile (original, without outputs)
 * @param blockOutputs - Outputs from executed blocks
 * @param timing - Execution start and end times
 * @returns The paths to the saved snapshot files
 */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: BlockExecutionOutput[],
  timing: ExecutionTiming
): Promise<SaveSnapshotResult> {
  const result: SaveExecutionSnapshotResult = await saveExecutionSnapshotShared(sourcePath, file, blockOutputs, timing)

  debug(`Saved execution snapshot to: ${result.timestampedSnapshotPath}`)
  debug(`Updated latest snapshot: ${result.snapshotPath}`)

  return {
    snapshotPath: result.snapshotPath,
    timestampedSnapshotPath: result.timestampedSnapshotPath,
  }
}
