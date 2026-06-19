import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { getSnapshotDir } from './lookup'
import { resolveSnapshotNotebookId } from './snapshot-notebook-id'
import { generateSnapshotFilename, slugifyProjectName, splitDeepnoteFile } from './split'

/**
 * Result of a single block execution (subset of BlockResult from the runner).
 *
 * Note: `outputs` is typed as `unknown[]` so that `@deepnote/convert` does not
 * depend on `@deepnote/runtime-core`. `IOutput[]` is assignable to `unknown[]`,
 * so callers holding typed outputs can pass them through unchanged.
 */
export interface BlockExecutionOutput {
  id: string
  outputs: unknown[]
  executionCount?: number | null
}

/**
 * Execution timing information.
 */
export interface ExecutionTiming {
  startedAt: string
  finishedAt: string
}

/**
 * Result of saving a snapshot.
 */
export interface SaveExecutionSnapshotResult {
  snapshotPath: string
  timestampedSnapshotPath: string
}

/**
 * Merges execution outputs into a DeepnoteFile.
 *
 * @param file - The original DeepnoteFile
 * @param blockOutputs - Outputs from executed blocks
 * @param timing - Execution start and end times
 * @returns A new DeepnoteFile with outputs merged in
 */
export function mergeOutputsIntoFile(
  file: DeepnoteFile,
  blockOutputs: ReadonlyArray<BlockExecutionOutput>,
  timing: ExecutionTiming
): DeepnoteFile {
  const outputsByBlockId = new Map(blockOutputs.map(r => [r.id, r]))

  return {
    ...file,
    execution: {
      startedAt: timing.startedAt,
      finishedAt: timing.finishedAt,
    },
    project: {
      ...file.project,
      notebooks: file.project.notebooks.map(notebook => ({
        ...notebook,
        blocks: notebook.blocks.map(block => {
          const result = outputsByBlockId.get(block.id)
          if (!result) return block

          // Strip every stale execution field before re-applying, else prior timing leaks when this run produced none.
          const {
            outputs: _prevOutputs,
            executionCount: _prevExecutionCount,
            executionStartedAt: _prevExecutionStartedAt,
            executionFinishedAt: _prevExecutionFinishedAt,
            ...rest
          } = block as typeof block & {
            outputs?: unknown[]
            executionCount?: number | null
            executionStartedAt?: string
            executionFinishedAt?: string
          }
          return {
            ...rest,
            outputs: result.outputs,
            ...(result.executionCount != null ? { executionCount: result.executionCount } : {}),
          } as typeof block
        }),
      })),
    },
  }
}

/**
 * Saves execution outputs to a snapshot file.
 *
 * Creates a snapshot file in the snapshots/ directory next to the source file.
 * The snapshot contains all block outputs and execution metadata, and is keyed by
 * the file's notebook id (single notebook, else the main notebook in `[init, main]`
 * shape; see {@link resolveSnapshotNotebookId}). The file is written as-is — callers
 * are responsible for shaping it (e.g. excluding a borrowed init notebook).
 *
 * @param sourcePath - Path to the original source file (or where it would be if converted)
 * @param file - The DeepnoteFile (original, without outputs)
 * @param blockOutputs - Outputs from executed blocks
 * @param timing - Execution start and end times
 * @returns The paths to the saved (latest + timestamped) snapshot files
 */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: ReadonlyArray<BlockExecutionOutput>,
  timing: ExecutionTiming
): Promise<SaveExecutionSnapshotResult> {
  // Merge outputs into the file
  const fileWithOutputs = mergeOutputsIntoFile(file, blockOutputs, timing)

  // Split into source and snapshot (we only need the snapshot)
  const { snapshot } = splitDeepnoteFile(fileWithOutputs)

  // Determine snapshot paths
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const timestamp = new Date(timing.finishedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const notebookId = resolveSnapshotNotebookId(file)
  await fs.mkdir(snapshotDir, { recursive: true })
  const timestampedFilename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId, timestamp })
  const timestampedSnapshotPath = resolve(snapshotDir, timestampedFilename)
  const latestFilename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId })
  const snapshotPath = resolve(snapshotDir, latestFilename)

  // Create snapshot directory if it doesn't exist
  await fs.mkdir(snapshotDir, { recursive: true })

  // Write timestamped snapshot first, then copy to latest to reduce corruption risk
  const snapshotYaml = serializeDeepnoteSnapshot(snapshot)
  await fs.writeFile(timestampedSnapshotPath, snapshotYaml, 'utf-8')
  await fs.copyFile(timestampedSnapshotPath, snapshotPath)

  return { snapshotPath, timestampedSnapshotPath }
}

export interface SaveExecutionSnapshotForRunParams {
  /** Path to the source file (already rewritten to the .deepnote equivalent by the caller when the input was converted). */
  sourcePath: string
  /** The DeepnoteFile to snapshot (without outputs). May still contain a borrowed/composed init notebook. */
  file: DeepnoteFile
  /** Outputs from executed blocks (init + main). Only `id`/`outputs` are read. */
  blockOutputs: ReadonlyArray<BlockExecutionOutput>
  /** Execution start/end times. Caller-supplied for determinism. */
  timing: ExecutionTiming
  /** Block ids belonging to the composed init notebook. Non-empty => composed run. undefined is treated as empty. */
  initBlockIds?: ReadonlySet<string> | undefined
}

/**
 * Save an execution snapshot for a run, applying the two init-aware rules every run-command caller
 * needs:
 *  1. Skip the save (return `undefined`) for an init-only composed run — nothing non-init executed,
 *     so writing would clobber the main snapshot with empty-main outputs.
 *  2. Exclude the borrowed init notebook from the written file so the snapshot matches the main source.
 * Returns the saved paths, or `undefined` when the save was skipped. Throws if the underlying write
 * fails — callers decide whether to treat snapshot persistence as best-effort (e.g. catch and log).
 */
export async function saveExecutionSnapshotForRun(
  params: SaveExecutionSnapshotForRunParams
): Promise<SaveExecutionSnapshotResult | undefined> {
  const { sourcePath, file, blockOutputs, timing, initBlockIds } = params
  const ids = initBlockIds ?? new Set<string>()
  const isComposed = ids.size > 0
  const hasNonInitOutput = blockOutputs.some(output => !ids.has(output.id))
  // Init-only composed run: nothing non-init executed, so writing would clobber the main snapshot. Skip.
  if (isComposed && !hasNonInitOutput) {
    return undefined
  }

  // Exclude the borrowed init notebook so the snapshot matches the single-notebook main source.
  const initNotebookId = file.project.initNotebookId
  const snapshotFile =
    isComposed && initNotebookId !== undefined
      ? {
          ...file,
          project: {
            ...file.project,
            notebooks: file.project.notebooks.filter(notebook => notebook.id !== initNotebookId),
          },
        }
      : file

  return saveExecutionSnapshot(sourcePath, snapshotFile, blockOutputs, timing)
}

/**
 * Gets the path where a snapshot would be saved for a given source file.
 *
 * @param sourcePath - Path to the source file
 * @param file - The DeepnoteFile
 * @returns The snapshot file path
 */
export function getSnapshotPath(sourcePath: string, file: DeepnoteFile): string {
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const notebookId = resolveSnapshotNotebookId(file)
  const snapshotFilename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId })
  return resolve(snapshotDir, snapshotFilename)
}
