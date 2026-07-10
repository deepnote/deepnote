import { dirname } from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import type { BlockExecutionOutput } from '@deepnote/convert'
import { mergeOutputsIntoFile, saveExecutionSnapshot, splitDeepnoteFile } from '@deepnote/convert'
import type { BlockExecutionResult, ExecutionSummary, IOutput } from '@deepnote/runtime-core'
import { detectDefaultPython, ExecutionEngine } from '@deepnote/runtime-core'
import { applyInputOverrides } from './apply-input-overrides'
import type { DeepnoteInput } from './load-file'
import { loadDeepnoteFile } from './load-file'

export interface RunWithInputsOptions {
  /** Python venv directory or executable. Defaults to `detectDefaultPython()`. */
  pythonEnv?: string
  /** Working directory for execution. Defaults to the source file's directory, else `process.cwd()`. */
  workingDirectory?: string
  /** Run only this notebook (by name). */
  notebook?: string
  /** Run only this block (by id). */
  blockId?: string
  /** Run only these blocks (by id). Takes precedence over `blockId`. No upstream-dependency expansion. */
  blockIds?: string[]
  /**
   * Persist the snapshot to disk (sibling `snapshots/` directory). Requires a filesystem-path
   * input — throws if the input was a YAML string or an object (no source path to write next to).
   */
  persistSnapshot?: boolean
  /** Called for each streamed output as it is produced. */
  onOutput?: (blockId: string, output: IOutput) => void
}

export interface RunBlockOutput {
  blockId: string
  outputs: IOutput[]
  executionCount: number | null
}

export interface RunWithInputsResult {
  /** Per-block outputs, in execution order. */
  outputs: RunBlockOutput[]
  /** Aggregate counts. `failedBlocks > 0` means a block failed — the run still returns (it does not throw). */
  summary: ExecutionSummary
  /** In-memory execution snapshot (outputs merged inline). */
  snapshot: DeepnoteSnapshot
  /** The snapshot serialized to `.deepnote` YAML. */
  snapshotYaml: string
  /** Path of the persisted snapshot, set only when `persistSnapshot` was requested with a path input. */
  snapshotPath?: string
}

/**
 * Run a `.deepnote` notebook locally with input overrides applied, returning the block
 * outputs and an execution snapshot.
 *
 * Overrides are coerced to the schema shape for the persisted file, while the raw native
 * values are what get injected into the kernel — these are intentionally different.
 *
 * Throws only on infrastructure/config errors (no Python environment, missing toolkit,
 * an invalid file, or `persistSnapshot` without a path). A failing block is reported via
 * `summary.failedBlocks`, not thrown.
 */
export async function runWithInputs(
  input: DeepnoteInput,
  inputs: Record<string, unknown> = {},
  options: RunWithInputsOptions = {}
): Promise<RunWithInputsResult> {
  const { file, sourcePath } = loadDeepnoteFile(input)
  applyInputOverrides(file, inputs)

  const pythonEnv = options.pythonEnv ?? detectDefaultPython()
  const workingDirectory = options.workingDirectory ?? (sourcePath ? dirname(sourcePath) : process.cwd())

  const engine = new ExecutionEngine({ pythonEnv, workingDirectory })
  const blockResults: BlockExecutionResult[] = []
  const startedAt = new Date().toISOString()
  let started = false

  try {
    await engine.start()
    started = true

    const summary = await engine.runProject(file, {
      notebookName: options.notebook,
      blockId: options.blockId,
      blockIds: options.blockIds,
      // Raw native values for kernel injection — NOT the coerced metadata values.
      inputs,
      onBlockDone: result => {
        blockResults.push(result)
      },
      onOutput: options.onOutput,
    })

    const timing = { startedAt, finishedAt: new Date().toISOString() }

    // Build the block-outputs list once so the in-memory and persisted snapshots are
    // derived from the same (file, outputs, timing) and cannot drift.
    const blockOutputs: BlockExecutionOutput[] = blockResults.map(r => ({
      id: r.blockId,
      outputs: r.outputs,
      executionCount: r.executionCount,
    }))

    const { snapshot } = splitDeepnoteFile(mergeOutputsIntoFile(file, blockOutputs, timing))
    const snapshotYaml = serializeDeepnoteSnapshot(snapshot)

    let snapshotPath: string | undefined
    if (options.persistSnapshot) {
      if (!sourcePath) {
        throw new Error(
          'runWithInputs: persistSnapshot requires a filesystem-path input; a YAML string or DeepnoteFile object has no source path to write a snapshot next to.'
        )
      }
      snapshotPath = (await saveExecutionSnapshot(sourcePath, file, blockOutputs, timing)).snapshotPath
    }

    const outputs: RunBlockOutput[] = blockResults.map(r => ({
      blockId: r.blockId,
      outputs: r.outputs,
      executionCount: r.executionCount,
    }))

    return { outputs, summary, snapshot, snapshotYaml, snapshotPath }
  } finally {
    if (started) await engine.stop()
  }
}
