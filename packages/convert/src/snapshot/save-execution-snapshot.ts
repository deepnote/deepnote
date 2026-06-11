import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { getSnapshotDir } from './lookup'
import { resolveSnapshotNotebookId } from './snapshot-notebook-id'
import { generateSnapshotFilename, slugifyProjectName, splitDeepnoteFile } from './split'

/** Result of a single block execution to merge into a snapshot; `outputs` is `unknown[]` to avoid a Jupyter type dependency. */
export interface BlockExecutionOutput {
  id: string
  outputs: unknown[]
  executionCount?: number | null
}

/** Execution timing window for a single run. */
export interface ExecutionTiming {
  startedAt: string
  finishedAt: string
}

/** Result of saving an execution snapshot; the init-only paths are set only for composed runs. */
export interface SaveExecutionSnapshotResult {
  /** Path to the latest main snapshot (the user-targeted notebook view). */
  snapshotPath: string
  /** Path to the timestamped main snapshot. */
  timestampedSnapshotPath: string
  /** Path to the init-only `latest` snapshot, when this was a composed run. */
  initSnapshotPath?: string
  /** Path to the init-only timestamped snapshot, when this was a composed run. */
  initTimestampedSnapshotPath?: string
}

/** Options controlling {@link saveExecutionSnapshot}'s composed-run behavior. */
export interface SaveExecutionSnapshotOptions {
  /** Init-notebook block ids; non-empty means `file` is a `[init, main]`-composed run (two snapshots), empty means self-contained (one). */
  initBlockIds?: ReadonlySet<string> | undefined
}

/** Merges execution outputs into a DeepnoteFile, replacing stale execution fields on referenced blocks. */
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

/** Saves execution outputs to one snapshot, or two for a composed run (main + init-only); the main snapshot is skipped for init-only runs to avoid a misleading empty-main record. */
export async function saveExecutionSnapshot(
  sourcePath: string,
  file: DeepnoteFile,
  blockOutputs: ReadonlyArray<BlockExecutionOutput>,
  timing: ExecutionTiming,
  options: SaveExecutionSnapshotOptions = {}
): Promise<SaveExecutionSnapshotResult> {
  const fileWithOutputs = mergeOutputsIntoFile(file, blockOutputs, timing)

  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const timestamp = new Date(timing.finishedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)

  await fs.mkdir(snapshotDir, { recursive: true })

  // Skip the main snapshot for a composed run whose only outputs are init blocks (e.g. `--block=<initBlockId>`).
  const initBlockIds: ReadonlySet<string> = options.initBlockIds ?? new Set<string>()
  const isComposed = initBlockIds.size > 0
  const hasNonInitOutput = blockOutputs.some(output => !initBlockIds.has(output.id))
  const writeMainSnapshot = !isComposed || hasNonInitOutput

  const mainNotebookId = resolveSnapshotNotebookId(file)
  const mainTimestampedFilename = generateSnapshotFilename({
    slug,
    projectId: file.project.id,
    notebookId: mainNotebookId,
    timestamp,
  })
  const mainTimestampedPath = resolve(snapshotDir, mainTimestampedFilename)
  const mainLatestFilename = generateSnapshotFilename({
    slug,
    projectId: file.project.id,
    notebookId: mainNotebookId,
  })
  const mainLatestPath = resolve(snapshotDir, mainLatestFilename)

  const initNotebookId = file.project.initNotebookId
  const initNotebook =
    isComposed && initNotebookId !== undefined
      ? fileWithOutputs.project.notebooks.find(nb => nb.id === initNotebookId)
      : undefined
  let initTimestampedPath: string | undefined
  let initLatestPath: string | undefined

  if (initNotebook !== undefined) {
    const initOnlyFile: DeepnoteFile = {
      ...fileWithOutputs,
      project: {
        ...fileWithOutputs.project,
        notebooks: [initNotebook],
      },
    }
    const { snapshot: initSnapshot } = splitDeepnoteFile(initOnlyFile)

    const initTimestampedFilename = generateSnapshotFilename({
      slug,
      projectId: file.project.id,
      notebookId: initNotebook.id,
      timestamp,
    })
    initTimestampedPath = resolve(snapshotDir, initTimestampedFilename)
    const initLatestFilename = generateSnapshotFilename({
      slug,
      projectId: file.project.id,
      notebookId: initNotebook.id,
    })
    initLatestPath = resolve(snapshotDir, initLatestFilename)

    const initYaml = serializeDeepnoteSnapshot(initSnapshot)
    await fs.writeFile(initTimestampedPath, initYaml, 'utf-8')
    await fs.copyFile(initTimestampedPath, initLatestPath)
  }

  let mainTimestampedFinal: string | undefined
  let mainLatestFinal: string | undefined
  if (writeMainSnapshot) {
    const { snapshot: mainSnapshot } = splitDeepnoteFile(fileWithOutputs)
    const mainYaml = serializeDeepnoteSnapshot(mainSnapshot)
    await fs.writeFile(mainTimestampedPath, mainYaml, 'utf-8')
    await fs.copyFile(mainTimestampedPath, mainLatestPath)
    mainTimestampedFinal = mainTimestampedPath
    mainLatestFinal = mainLatestPath
  }

  // When the main snapshot was skipped, surface the init paths in the legacy slots for single-result callers.
  return {
    snapshotPath: mainLatestFinal ?? initLatestPath ?? mainLatestPath,
    timestampedSnapshotPath: mainTimestampedFinal ?? initTimestampedPath ?? mainTimestampedPath,
    initSnapshotPath: initLatestPath,
    initTimestampedSnapshotPath: initTimestampedPath,
  }
}

/** Returns the path where the (main) snapshot would be saved for `sourcePath`. */
export function getSnapshotPath(sourcePath: string, file: DeepnoteFile): string {
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const notebookId = resolveSnapshotNotebookId(file)
  const filename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId })
  return resolve(snapshotDir, filename)
}
