import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { generateSnapshotFilename, getSnapshotDir, slugifyProjectName, splitDeepnoteFile } from '@deepnote/convert'
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
 * Execution timing information
 */
export interface ExecutionTiming {
  startedAt: string
  finishedAt: string
}

/**
 * Result of saving a snapshot
 */
export interface SaveSnapshotResult {
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

          // Spread the block and then handle executionCount explicitly
          // Cast to record to handle executionCount which may not exist on all block types
          const blockRecord = block as Record<string, unknown>
          const { executionCount: _prevExecutionCount, ...rest } = blockRecord
          // Merge outputs into the block
          return {
            ...rest,
            outputs: result.outputs,
            // Only include executionCount if it's defined
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
 * @returns The path to the saved snapshot file
 */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: BlockExecutionOutput[],
  timing: ExecutionTiming
): Promise<SaveSnapshotResult> {
  // Merge outputs into the file
  const fileWithOutputs = mergeOutputsIntoFile(file, blockOutputs, timing)

  // Split into source and snapshot (we only need the snapshot)
  const { snapshot } = splitDeepnoteFile(fileWithOutputs)

  // Determine snapshot paths
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'

  const timestamp = new Date(timing.finishedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const timestampedFilename = generateSnapshotFilename(slug, file.project.id, timestamp)
  const timestampedSnapshotPath = resolve(snapshotDir, timestampedFilename)

  const latestFilename = generateSnapshotFilename(slug, file.project.id, 'latest')
  const snapshotPath = resolve(snapshotDir, latestFilename)

  // Create snapshot directory if it doesn't exist
  await fs.mkdir(snapshotDir, { recursive: true })

  // Serialize and write both snapshot files
  const snapshotYaml = serializeDeepnoteSnapshot(snapshot)
  await fs.writeFile(timestampedSnapshotPath, snapshotYaml, 'utf-8')
  await fs.writeFile(snapshotPath, snapshotYaml, 'utf-8')

  debug(`Saved execution snapshot to: ${timestampedSnapshotPath}`)
  debug(`Updated latest snapshot: ${snapshotPath}`)

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
  const snapshotFilename = generateSnapshotFilename(slug, file.project.id, 'latest')
  return resolve(snapshotDir, snapshotFilename)
}
