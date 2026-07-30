import { dirname } from 'node:path'
import type { DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import type { BlockExecutionOutput } from '@deepnote/convert'
import { mergeOutputsIntoFile, saveExecutionSnapshot, splitDeepnoteFile } from '@deepnote/convert'
import type { AgentStreamEvent, BlockExecutionResult, ExecutionSummary, IOutput } from '@deepnote/runtime-core'
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
   * Persist the snapshot to disk in a sibling `snapshots/` directory, like `deepnote run`.
   * Defaults to `true`; pass `false` to skip. When the input has no source path (a YAML string
   * or a DeepnoteFile object) there is nowhere to write, so persistence is skipped.
   */
  persistSnapshot?: boolean
  /** Called for each streamed output as it is produced. */
  onOutput?: (blockId: string, output: IOutput) => void
  /**
   * Called for each agent-block streaming event — text/reasoning deltas and tool calls — as the
   * agent produces them. Where `onOutput` streams a code block's outputs live, this streams an
   * agent block's incremental activity; the agent's final text still lands in the snapshot outputs.
   */
  onAgentEvent?: (event: AgentStreamEvent) => void | Promise<void>
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
  /** Path of the persisted snapshot; set when a snapshot was written to disk (path input, not opted out). */
  snapshotPath?: string
}

/**
 * Run a `.deepnote` notebook locally with input overrides applied, returning the block
 * outputs and an execution snapshot.
 *
 * Overrides are coerced to the schema shape their input block requires (a slider takes `7` or
 * `'7'` and stores `'7'`), and the coerced values are what both the persisted file and the kernel
 * see.
 *
 * By default it writes an execution snapshot next to a path input, like `deepnote run` (pass
 * `persistSnapshot: false` to skip; inputs without a path are never persisted).
 *
 * Throws only on infrastructure/config errors (no Python environment, missing toolkit, or an
 * invalid file). A failing block is reported via `summary.failedBlocks`, not thrown.
 */
export async function runWithInputs(
  input: DeepnoteInput,
  inputs: Record<string, unknown> = {},
  options: RunWithInputsOptions = {}
): Promise<RunWithInputsResult> {
  const { file, sourcePath } = loadDeepnoteFile(input)

  // Fail fast on an impossible request — persistence needs a path to write beside — before
  // starting the engine, so an invalid config can't trigger execution or side effects. (An
  // unset `persistSnapshot` with no path is fine: persistence is simply skipped.)
  if (options.persistSnapshot === true && !sourcePath) {
    throw new Error('persistSnapshot: true requires a file path input (a YAML string or object has nowhere to write).')
  }

  // Scope coercion to the notebook the engine will run. `--notebook` names it; a block-targeted run
  // (`blockId`/`blockIds`) with no notebook is scoped to the block's own notebook so a same-named
  // input in another notebook can't be coerced against — or mutated by — this run. The same scope is
  // handed to the engine below, so injection and coercion stay in lockstep.
  const notebookScope = options.notebook ?? notebookNameForTargetBlocks(file, options)
  const coercedInputs = applyInputOverrides(file, inputs, { notebook: notebookScope })

  // Values for names that match an input block are coerced to that block's schema shape; the
  // engine validates against that same shape, so a raw `7` for a slider would be rejected. Names
  // with no input block are passed through untouched for generic kernel injection.
  const engineInputs = { ...inputs, ...coercedInputs }

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
      notebookName: notebookScope,
      blockId: options.blockId,
      blockIds: options.blockIds,
      inputs: engineInputs,
      onBlockDone: result => {
        blockResults.push(result)
      },
      onOutput: options.onOutput,
      onAgentEvent: options.onAgentEvent,
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

    // Persist next to a path input by default (like `deepnote run`); skip when opted out or
    // when there is no source path to write beside.
    let snapshotPath: string | undefined
    if (options.persistSnapshot !== false && sourcePath) {
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

/**
 * The name of the single notebook that contains the targeted block(s), so a `blockId`/`blockIds` run
 * with no explicit `--notebook` still scopes inputs (and the engine's injection) to that notebook.
 * Returns undefined when no blocks are targeted, or when they span more than one notebook — the run
 * then stays unscoped, exactly as before.
 */
function notebookNameForTargetBlocks(file: DeepnoteFile, options: RunWithInputsOptions): string | undefined {
  const ids = options.blockIds ?? (options.blockId ? [options.blockId] : [])
  if (ids.length === 0) return undefined

  const idSet = new Set(ids)
  const names = new Set<string>()
  for (const notebook of file.project.notebooks) {
    if (notebook.blocks.some(block => idSet.has(block.id))) {
      names.add(notebook.name)
    }
  }
  return names.size === 1 ? [...names][0] : undefined
}
