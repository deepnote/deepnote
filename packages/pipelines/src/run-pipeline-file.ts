import type { DeepnoteFile, NotebookFunctionInput } from '@deepnote/blocks'
import type { CloudExecutorOptions } from './cloud-executor'
import { createCloudStepExecutor } from './cloud-executor'
import { evaluateCondition } from './condition-expression'
import type {
  PipelineContext,
  PipelineOptions,
  PipelineResult,
  PipelineStepExecutor,
  PipelineStepResult,
} from './pipeline'
import { PipelineRunError, PipelineStepError, runPipelineWithExecutor } from './pipeline'
import type { PipelinePlan, PlannedStep, PlanOptions } from './pipeline-plan'
import { planPipeline } from './pipeline-plan'

/**
 * Run a pipeline that a `.deepnote` file defines.
 *
 * The pipeline notebook is interpreted, not executed: its `notebook-function` blocks become steps
 * in the ordinary pipeline engine, so independent steps run concurrently and each one reports its
 * own status — neither of which survives handing the parent to Deepnote's sequential block engine.
 *
 * What the file buys is that the pipeline stops being application code. The same manifest runs from
 * a browser, a script, or CI, and it can be reviewed and versioned like the notebooks it composes.
 */

/** The most elements one `for_each` step may fan out to. More is a run-time error naming the step. */
export const MAX_FOR_EACH_WIDTH = 50

export interface PlanRunResult<T> extends PipelineResult<T> {
  /** The plan that was executed, for a UI that wants to draw it before anything runs. */
  plan: PipelinePlan
  /**
   * Steps that did not run: their `run_if` was false, or they read a value from a step that was
   * itself skipped. Reported rather than silently absent, so a page can grey them out.
   */
  skipped: string[]
  /** Steps marked `allow_failure` whose run failed. Their exports were not published. */
  failed: string[]
}

export interface PlanPipelineResult {
  variables: Record<string, unknown>
  skipped: string[]
  failed: string[]
}

/**
 * What `runPipelineFile` rejects with: the engine's error — `partial` holds the steps and graph
 * recorded so far — plus the file runner's own state at that moment, so a caller can render every
 * variable that did arrive alongside the step that stopped the run.
 */
export type PipelineFileError = (PipelineStepError | PipelineRunError) & PlanPipelineResult

/** "This variable never arrived": its producer was skipped, or failed with `allow_failure`. */
const UNAVAILABLE = Symbol('unavailable')

/**
 * The value an input resolves to in a scope.
 *
 * A `variable_name` reads the pipeline variable of that name. When it is unavailable the fallback is
 * consulted, and so on down the chain; a chain that ends without a value is UNAVAILABLE, which is
 * what skips the step. Without a `variable_name` the input is the literal `custom_value`.
 */
function resolveInput(input: NotebookFunctionInput, scope: Record<string, unknown>): unknown | typeof UNAVAILABLE {
  const name = input.variable_name
  if (typeof name === 'string' && name !== '') {
    if (Object.hasOwn(scope, name)) {
      return scope[name]
    }
    return input.fallback ? resolveInput(input.fallback, scope) : UNAVAILABLE
  }
  return input.custom_value ?? null
}

/** The variables a completed step publishes, read from its structured output. */
function exportsFrom(
  step: { exports: Record<string, string>; id: string },
  result: PipelineStepResult,
  outputs: PipelineContext['outputs']
): Record<string, unknown> {
  const names = Object.entries(step.exports)
  if (names.length === 0) {
    return {}
  }
  // One structured value per step, read without depending on block ids — Deepnote reassigns those
  // when it creates a notebook, so reading by id would break the first time a pipeline is published.
  let value: unknown
  try {
    value = outputs.lastJson(result)
  } catch (error) {
    throw new Error(
      `Step "${step.id}" exports ${names.map(([name]) => `"${name}"`).join(', ')} but produced no structured JSON output: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Step "${step.id}" exports values, so its last output must end with a JSON object.`)
  }
  const record = value as Record<string, unknown>
  const published: Record<string, unknown> = {}
  for (const [exportName, variableName] of names) {
    if (!(exportName in record)) {
      throw new Error(
        `Step "${step.id}" exports "${exportName}", which its output does not contain. It produced: ${Object.keys(record).join(', ') || '(nothing)'}.`
      )
    }
    published[variableName] = record[exportName]
  }
  return published
}

/** One run of a step: the whole step, or one element of a `for_each` fan-out. */
interface Instance {
  id: string
  label: string
  /** Variables visible to this instance — the pipeline's, plus the loop binding. */
  scope: Record<string, unknown>
}

/**
 * Execute a plan, running every step whose dependencies are met at the same time.
 *
 * This is an ordinary workflow callback, so it reuses the engine's graph, events, and output
 * helpers rather than reimplementing them — the declarative front end and the imperative one
 * produce identical results.
 */
export function pipelineForPlan(plan: PipelinePlan, state: PlanPipelineResult = emptyState()) {
  return async ({ run, control, outputs }: PipelineContext): Promise<PlanPipelineResult> => {
    // The runner writes into `state` as it goes, so whoever supplied it can read what had been
    // published, skipped and tolerated even when the run ends in a rejection.
    const { variables, skipped, failed } = state
    const pending = new Map(plan.steps.map(step => [step.id, step]))
    const settled = new Set<string>()
    const running = new Map<string, Promise<void>>()

    const skip = (id: string): void => {
      skipped.push(id)
      settled.add(id)
      pending.delete(id)
    }

    const markFailed = (id: string): void => {
      if (!failed.includes(id)) {
        failed.push(id)
      }
    }

    /**
     * Whether every variable the step's inputs need is available, once the loop variable is bound.
     *
     * Checked once per step rather than per element: the element itself is always available, so an
     * unavailable input is unavailable for every element, and the whole step is skipped.
     */
    const inputsAvailable = (step: PlannedStep): boolean => {
      const scope = step.forEach ? { ...variables, [step.forEachAs]: undefined } : variables
      return Object.values(step.inputs).every(input => resolveInput(input, scope) !== UNAVAILABLE)
    }

    /** Pass each input's resolved value to the notebook. */
    const resolveInputs = (step: PlannedStep, scope: Record<string, unknown>): Record<string, unknown> => {
      const resolved: Record<string, unknown> = {}
      for (const [name, input] of Object.entries(step.inputs)) {
        resolved[name] = resolveInput(input, scope)
      }
      return resolved
    }

    /**
     * The element list a `for_each` step expands over, `null` when it is not a fan-out, or
     * UNAVAILABLE when the array it iterates never arrived.
     */
    const expand = (step: PlannedStep): Instance[] | null | typeof UNAVAILABLE => {
      if (step.forEach === undefined) {
        return null
      }
      if (!Object.hasOwn(variables, step.forEach)) {
        return UNAVAILABLE
      }
      const list = variables[step.forEach]
      if (!Array.isArray(list)) {
        throw new Error(
          `Step "${step.id}" iterates "${step.forEach}", which is ${list === null ? 'null' : `a ${typeof list}`}. function_notebook_for_each needs an array.`
        )
      }
      if (list.length > MAX_FOR_EACH_WIDTH) {
        throw new Error(
          `Step "${step.id}" would fan out to ${list.length} runs of "${step.forEach}"; the limit is ${MAX_FOR_EACH_WIDTH}.`
        )
      }
      return list.map((item, index) => ({
        id: `${step.id}[${index}]`,
        label: `${step.label} ${index + 1}/${list.length}`,
        scope: { ...variables, [step.forEachAs]: item },
      }))
    }

    /**
     * Give a fan-out a node of its own.
     *
     * Its runs are registered under `id[0]`, `id[1]`, … so without this there is no node named
     * `id` at all, and any step declaring `dependsOn: [id]` is rejected as depending on something
     * that never started. The join also reads correctly in the graph: N runs converging on one
     * result, including the case where N is zero.
     */
    const joinFanOut = async (step: PlannedStep, instanceIds: string[], fallback: string[]): Promise<void> => {
      await control(
        {
          id: step.id,
          kind: 'join',
          label: step.label,
          dependsOn: instanceIds.length > 0 ? instanceIds : fallback,
          metadata: { elements: instanceIds.length },
        },
        () => null
      )
    }

    /** Decide whether one instance runs: its gate, if it has one. */
    const admit = async (step: PlannedStep, instance: Instance, dependsOn: string[]): Promise<boolean> => {
      if (!step.condition) {
        return true
      }
      // The gate is a control node, so the decision appears in the graph next to the step it
      // governs instead of happening invisibly. A variable whose producer was skipped reads as
      // absent here, so a gate can still ask `recovered == null`.
      return Boolean(
        await control(
          {
            id: `${instance.id}-gate`,
            kind: 'gate',
            label: step.condition,
            dependsOn,
            metadata: { condition: step.condition },
          },
          () => evaluateCondition(step.condition as string, instance.scope)
        )
      )
    }

    /**
     * Read one run's exports, treating an unreadable export like a failed run.
     *
     * A notebook that finished but printed no JSON object, or one missing an exported key, has not
     * delivered what the pipeline asked of it. Under `allow_failure` the step is recorded in `failed`
     * and publishes nothing from this run; otherwise it fails the pipeline as a step error naming
     * the step, so the caller learns which notebook to fix rather than seeing a bare message.
     */
    const readExports = (
      step: PlannedStep,
      { instance, result }: { instance: Instance; result: PipelineStepResult }
    ): Record<string, unknown> | null => {
      try {
        return exportsFrom(step, result, outputs)
      } catch (error) {
        if (step.allowFailure) {
          markFailed(step.id)
          return null
        }
        throw new PipelineStepError(instance.id, error instanceof Error ? error.message : String(error), {
          result,
          cause: error,
        })
      }
    }

    /**
     * Publish a step's exports. A fan-out collects one array per exported name, in element order.
     *
     * A failed run (allowed by `allow_failure`) publishes nothing: a plain step's variables stay
     * unavailable, and a fan-out collects only from the elements that succeeded — and, of those,
     * only the ones whose output could be read.
     */
    const publish = (step: PlannedStep, results: { instance: Instance; result: PipelineStepResult }[]): void => {
      if (Object.keys(step.exports).length === 0) {
        return
      }
      const succeeded = results.filter(({ result }) => result.success)
      if (step.forEach === undefined) {
        const only = succeeded[0]
        if (only) {
          const published = readExports(step, only)
          if (published) {
            Object.assign(variables, published)
          }
        }
        return
      }
      const collected: Record<string, unknown[]> = {}
      for (const variableName of Object.values(step.exports)) {
        collected[variableName] = []
      }
      for (const entry of succeeded) {
        const published = readExports(step, entry)
        if (!published) {
          continue
        }
        for (const [variableName, value] of Object.entries(published)) {
          collected[variableName].push(value)
        }
      }
      Object.assign(variables, collected)
    }

    while (settled.size < plan.steps.length) {
      const ready = [...pending.values()].filter(step => step.dependsOn.every(id => settled.has(id)))

      if (ready.length === 0 && running.size === 0) {
        // Guarded against at plan time; reaching it means a step never settled.
        throw new Error('The pipeline stalled: no step is ready and none is running.')
      }

      for (const step of ready) {
        pending.delete(step.id)

        // A step whose inputs — or whose array — can never resolve is skipped rather than started
        // with a value that will never arrive. That is what propagates a skip downstream, and what
        // a fallback interrupts.
        const expanded = inputsAvailable(step) ? expand(step) : UNAVAILABLE
        if (expanded === UNAVAILABLE) {
          skip(step.id)
          continue
        }

        const instances = expanded ?? [{ id: step.id, label: step.label, scope: variables }]
        const gateDependsOn = step.dependsOn.filter(id => !skipped.includes(id))

        const admitted: Instance[] = []
        for (const instance of instances) {
          if (await admit(step, instance, gateDependsOn)) {
            admitted.push(instance)
          }
        }

        if (admitted.length === 0) {
          // A fan-out that ran nothing publishes empty arrays rather than being skipped, whether
          // the list was empty or every element was gated off — both mean "no element qualified",
          // and downstream deserves the same answer either way. A plain step is different: it
          // publishes a value, not a collection, so "none" there really is absent.
          if (step.forEach !== undefined) {
            publish(step, [])
            await joinFanOut(step, [], gateDependsOn)
            settled.add(step.id)
          } else {
            skip(step.id)
          }
          continue
        }

        running.set(
          step.id,
          Promise.all(
            admitted.map(instance =>
              run({
                id: instance.id,
                label: instance.label,
                notebookId: step.notebookId,
                dependsOn: step.condition ? [`${instance.id}-gate`] : gateDependsOn,
                inputs: resolveInputs(step, instance.scope),
                allowFailure: step.allowFailure,
              }).then(result => ({ instance, result }))
            )
          ).then(async results => {
            if (results.some(({ result }) => !result.success)) {
              markFailed(step.id)
            }
            publish(step, results)
            if (step.forEach !== undefined) {
              await joinFanOut(
                step,
                results.map(({ instance }) => instance.id),
                gateDependsOn
              )
            }
            settled.add(step.id)
            running.delete(step.id)
          })
        )
      }

      // Wake as soon as any step finishes so its dependents can start, rather than waiting for the
      // whole wave — a slow step must not hold back work that no longer depends on it.
      if (running.size > 0) {
        await Promise.race(running.values())
      }
    }

    return state
  }
}

function emptyState(): PlanPipelineResult {
  return { variables: {}, skipped: [], failed: [] }
}

export interface PipelineFileOptions extends PipelineOptions, PlanOptions {}

/**
 * Run the pipeline a `.deepnote` file defines, in Deepnote Cloud.
 *
 * This is the file-defined counterpart to `runPipeline`: same engine, same events, same graph —
 * the pipeline comes from a definition rather than from code.
 */
export async function runPipelineFile(
  file: DeepnoteFile,
  options: PipelineFileOptions & CloudExecutorOptions
): Promise<PlanRunResult<Record<string, unknown>>> {
  return runPipelineFileWithExecutor(file, options, createCloudStepExecutor(options))
}

/**
 * Plan a `.deepnote` file and run it with a caller-supplied executor.
 *
 * Rejects with a {@link PipelineFileError}: the engine's error, carrying the partial run, with the
 * runner's `variables`, `skipped` and `failed` so far attached alongside it.
 */
export async function runPipelineFileWithExecutor(
  file: DeepnoteFile,
  options: PipelineFileOptions,
  execute: PipelineStepExecutor
): Promise<PlanRunResult<Record<string, unknown>>> {
  const plan = planPipeline(file, options)
  const state = emptyState()
  let result: PipelineResult<PlanPipelineResult>
  try {
    result = await runPipelineWithExecutor(pipelineForPlan(plan, state), options, execute)
  } catch (error) {
    if (error instanceof PipelineStepError || error instanceof PipelineRunError) {
      const failure: PipelineFileError = Object.assign(error, state)
      throw failure
    }
    throw error
  }
  return { ...result, value: result.value.variables, plan, skipped: result.value.skipped, failed: result.value.failed }
}
