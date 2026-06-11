import type { DeepnoteFile } from '@deepnote/blocks'
import {
  type ExecutionTiming,
  type SaveExecutionSnapshotOptions,
  type SaveExecutionSnapshotResult,
  type BlockExecutionOutput as SharedBlockExecutionOutput,
  getSnapshotPath as sharedGetSnapshotPath,
  mergeOutputsIntoFile as sharedMergeOutputsIntoFile,
  saveExecutionSnapshot as sharedSaveExecutionSnapshot,
} from '@deepnote/convert'
import type { IOutput } from '@deepnote/runtime-core'
import { debug } from '../output'

/**
 * Result of a single block execution (subset of BlockResult from run.ts).
 *
 * Narrows the shared `BlockExecutionOutput.outputs` to runtime-core `IOutput` so CLI callers keep type-safety.
 */
export interface BlockExecutionOutputCli {
  id: string
  outputs: IOutput[]
  executionCount?: number | null
}

/** Backwards-compatible alias used by tests and other CLI modules. */
export type BlockExecutionOutput = BlockExecutionOutputCli

export type { ExecutionTiming }

/** Result of saving a snapshot. Composed runs additionally set init paths. */
export interface SaveSnapshotResult {
  snapshotPath: string
  timestampedSnapshotPath: string
  initSnapshotPath?: string
  initTimestampedSnapshotPath?: string
}

/** Re-export the shared merge helper for CLI callers. */
export const mergeOutputsIntoFile = sharedMergeOutputsIntoFile

/**
 * Saves execution outputs to a snapshot file.
 *
 * Thin CLI wrapper over shared `saveExecutionSnapshot` that keeps debug logging and the legacy CLI return shape.
 */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: BlockExecutionOutputCli[],
  timing: ExecutionTiming,
  options: SaveExecutionSnapshotOptions = {}
): Promise<SaveSnapshotResult> {
  const result: SaveExecutionSnapshotResult = await sharedSaveExecutionSnapshot(
    sourcePath,
    file,
    blockOutputs as SharedBlockExecutionOutput[],
    timing,
    options
  )

  debug(`Saved execution snapshot to: ${result.timestampedSnapshotPath}`)
  debug(`Updated latest snapshot: ${result.snapshotPath}`)
  if (result.initSnapshotPath !== undefined) {
    debug(`Saved init snapshot to: ${result.initTimestampedSnapshotPath}`)
    debug(`Updated latest init snapshot: ${result.initSnapshotPath}`)
  }

  return {
    snapshotPath: result.snapshotPath,
    timestampedSnapshotPath: result.timestampedSnapshotPath,
    initSnapshotPath: result.initSnapshotPath,
    initTimestampedSnapshotPath: result.initTimestampedSnapshotPath,
  }
}

/** Returns the path where a snapshot would be saved for a given source file. */
export const getSnapshotPath = sharedGetSnapshotPath
