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
 * Same shape as the shared `BlockExecutionOutput` but narrows `outputs` to the
 * runtime-core `IOutput` type so existing CLI callers keep their type-safety
 * against runtime types.
 */
export interface BlockExecutionOutputCli {
  id: string
  outputs: IOutput[]
  executionCount?: number | null
}

/**
 * Backwards-compatible alias used by tests and other CLI modules.
 *
 * Identical to {@link BlockExecutionOutputCli}.
 */
export type BlockExecutionOutput = BlockExecutionOutputCli

// Re-export the shared timing type so legacy imports continue to work.
export type { ExecutionTiming }

/** Result of saving a snapshot. Composed runs additionally set init paths. */
export interface SaveSnapshotResult {
  snapshotPath: string
  timestampedSnapshotPath: string
  /** Path to the init-only `latest` snapshot when this was a composed run. */
  initSnapshotPath?: string
  /** Path to the init-only timestamped snapshot when this was a composed run. */
  initTimestampedSnapshotPath?: string
}

/** Re-export the shared merge helper for CLI callers. */
export const mergeOutputsIntoFile = sharedMergeOutputsIntoFile

/**
 * Saves execution outputs to a snapshot file.
 *
 * Thin CLI wrapper over the shared `@deepnote/convert.saveExecutionSnapshot`:
 * keeps debug logging and the legacy CLI return shape, while delegating the
 * actual merge/serialize/atomic-write logic to the shared helper. When
 * `options.initBlockIds` is set and non-empty, the helper additionally writes
 * an init-only `[init]` snapshot — see the shared helper's docs for details.
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
