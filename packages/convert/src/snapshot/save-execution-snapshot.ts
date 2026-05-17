import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { getSnapshotDir } from './lookup'
import { resolveSnapshotNotebookId } from './snapshot-notebook-id'
import { generateSnapshotFilename, slugifyProjectName, splitDeepnoteFile } from './split'

/**
 * Result of a single block execution that should be merged into a snapshot.
 *
 * Outputs are kept as `unknown[]` to avoid pulling a Jupyter type dependency
 * into `@deepnote/convert`; they are passed through unchanged into the
 * resulting snapshot.
 */
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

/**
 * Result of saving an execution snapshot. When the run was composed
 * (`initBlockIds` was non-empty), `initSnapshotPath` and
 * `initTimestampedSnapshotPath` are set to the additional init-only snapshot.
 */
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

/**
 * Options controlling {@link saveExecutionSnapshot}'s composed-run behavior.
 */
export interface SaveExecutionSnapshotOptions {
  /**
   * Block ids that came from the init notebook for this composed run. When set
   * and non-empty, `file` is treated as a `[init, main]`-composed file: a main
   * snapshot is written keyed off the main notebook id (so it stays distinct
   * from other user-facing notebooks), and an additional init-only snapshot is
   * written keyed off the init notebook id.
   *
   * Empty or omitted → behaves like a self-contained file: one snapshot per
   * the existing single/multi-notebook rules.
   */
  initBlockIds?: ReadonlySet<string> | undefined
}

/**
 * Merges execution outputs into a DeepnoteFile.
 *
 * For every block referenced in `blockOutputs`, replaces the block's stale
 * `outputs`/`executionCount`/`executionStartedAt`/`executionFinishedAt`
 * fields with the new values from this run. Blocks not referenced are passed
 * through unchanged. Result is structurally equivalent to a freshly-loaded
 * source file with the new outputs merged in.
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

          // Strip every stale execution field before re-applying. Without
          // stripping `executionStartedAt` / `executionFinishedAt`, prior
          // values would leak into the new snapshot when this run did not
          // produce them (e.g. agent-driven blocks without timing).
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
 * Saves execution outputs to one or two snapshot files depending on whether
 * this was a composed run.
 *
 * - **Self-contained** (no `initBlockIds`): writes one snapshot, the same as
 *   the legacy single-notebook flow. Filename is keyed by
 *   {@link resolveSnapshotNotebookId}.
 * - **Composed** (`initBlockIds` non-empty): treats `file` as `[init, main]`
 *   shape and writes:
 *     - The main snapshot covering both notebooks (init outputs from this run
 *       + main outputs), filename keyed off the main notebook id by the
 *       existing `[init, main]` rule in `resolveSnapshotNotebookId`. **Skipped**
 *       when `blockOutputs` only contains init block ids — i.e. the user ran
 *       `--block=<initBlockId>` and the main notebook was not executed; in
 *       that case writing a main snapshot would produce a misleading record
 *       with empty main outputs.
 *     - An additional init-only snapshot containing just the init notebook
 *       and its outputs from the same run, filename keyed off the init
 *       notebook id (single-notebook rule).
 *
 * Both snapshots land in the same `snapshots/` directory next to the source
 * file. For each snapshot the timestamped file is written first and then
 * copied to the `_latest` filename — same pattern as the legacy single-
 * snapshot flow. If a write fails or is interrupted, rerun.
 *
 * @param sourcePath - Path to the source file (or where it would be if converted)
 * @param file - The DeepnoteFile (typically without outputs; in composed runs
 *               this is the `[init, main]`-shaped file)
 * @param blockOutputs - Outputs from executed blocks (init blocks too, when composed)
 * @param timing - Execution start and end times
 * @param options - Optional composed-run signaling
 */
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

  // Determine whether this was a composed run, and whether any non-init
  // outputs were produced. When composed but the only outputs come from init
  // blocks (e.g. `--block=<initBlockId>`), skip the main snapshot — writing
  // it would produce a misleading record where the main notebook appears to
  // have executed with no outputs.
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

  // When the main snapshot was skipped, surface the init snapshot paths in
  // the legacy slots too so callers that expect a single result can read
  // them (init-only run still produced a snapshot worth knowing about).
  return {
    snapshotPath: mainLatestFinal ?? initLatestPath ?? mainLatestPath,
    timestampedSnapshotPath: mainTimestampedFinal ?? initTimestampedPath ?? mainTimestampedPath,
    initSnapshotPath: initLatestPath,
    initTimestampedSnapshotPath: initTimestampedPath,
  }
}

/**
 * Returns the path where the (main) snapshot would be saved for `sourcePath`.
 */
export function getSnapshotPath(sourcePath: string, file: DeepnoteFile): string {
  const snapshotDir = getSnapshotDir(sourcePath)
  const slug = slugifyProjectName(file.project.name) || 'project'
  const notebookId = resolveSnapshotNotebookId(file)
  const filename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId })
  return resolve(snapshotDir, filename)
}
