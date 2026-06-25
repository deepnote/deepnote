import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { getSnapshotDir } from './lookup'
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
  blockOutputs: BlockExecutionOutput[],
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

          // Spread the whole block (retaining any pre-existing executionCount),
          // overwrite outputs, and overlay executionCount only when the new
          // result supplies a non-null value.
          return {
            ...block,
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
 * The snapshot contains all block outputs and execution metadata.
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
): Promise<SaveExecutionSnapshotResult> {
  // Merge outputs into the file
  const fileWithOutputs = mergeOutputsIntoFile(file, blockOutputs, timing)

  // Split into source and snapshot (we only need the snapshot)
  const { snapshot } = splitDeepnoteFile(fileWithOutputs)

  // Determine snapshot paths
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'

  const timestamp = new Date(timing.finishedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const timestampedFilename = generateSnapshotFilename({ slug, projectId: file.project.id, timestamp })
  const timestampedSnapshotPath = resolve(snapshotDir, timestampedFilename)

  const latestFilename = generateSnapshotFilename({ slug, projectId: file.project.id, timestamp: 'latest' })
  const snapshotPath = resolve(snapshotDir, latestFilename)

  // Create snapshot directory if it doesn't exist
  await fs.mkdir(snapshotDir, { recursive: true })

  // Write timestamped snapshot first, then copy to latest to reduce corruption risk
  const snapshotYaml = serializeDeepnoteSnapshot(snapshot)
  await fs.writeFile(timestampedSnapshotPath, snapshotYaml, 'utf-8')
  await fs.copyFile(timestampedSnapshotPath, snapshotPath)

  return { snapshotPath, timestampedSnapshotPath }
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
  const snapshotFilename = generateSnapshotFilename({ slug, projectId: file.project.id, timestamp: 'latest' })
  return resolve(snapshotDir, snapshotFilename)
}
