import type { DeepnoteFile } from '@deepnote/blocks'
import type { CloudExecutorOptions } from './cloud-executor'
import { createCloudStepExecutor } from './cloud-executor'
import { evaluateCondition } from './condition-expression'
import type {
  OrchestrateOptions,
  OrchestrationContext,
  OrchestrationResult,
  OrchestrationStepExecutor,
  OrchestrationStepResult,
} from './orchestrate'
import { runOrchestration } from './orchestrate'
import type { OrchestrationPlan, PlannedStep, PlanOptions } from './orchestration-plan'
import { planOrchestration } from './orchestration-plan'
import { resolveValue, unresolvableGroups } from './reference-expression'

/**
 * Run a pipeline that a `.deepnote` file defines.
 *
 * The parent notebook is interpreted, not executed: its `notebook-function` blocks become steps in
 * the ordinary orchestration engine, so independent steps run concurrently and each one reports its
 * own status — neither of which survives handing the parent to Deepnote's sequential block engine.
 *
 * What the file buys is that the pipeline stops being application code. The same manifest runs from
 * a browser, a script, or CI, and it can be reviewed and versioned like the notebooks it composes.
 */

export interface PlanRunResult<T> extends OrchestrationResult<T> {
  /** The plan that was executed, for a UI that wants to draw it before anything runs. */
  plan: OrchestrationPlan
  /**
   * Steps that did not run: their `run_if` was false, or they read a value from a step that was
   * itself skipped. Reported rather than silently absent, so a page can grey them out.
   */
  skipped: string[]
}

/** The variables a completed step publishes, read from its structured output. */
function exportsFrom(
  step: { exports: Record<string, string>; id: string },
  result: OrchestrationStepResult,
  outputs: OrchestrationContext['outputs']
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
    throw new Error(`Step "${step.id}" exports values, so its last output must be a JSON object.`)
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

/**
 * Execute a plan, running every step whose dependencies are met at the same time.
 *
 * This is an ordinary workflow callback, so it reuses the engine's graph, events, and output
 * helpers rather than reimplementing them — the declarative front end and the imperative one
 * produce identical results.
 */
export interface PlanWorkflowResult {
  variables: Record<string, unknown>
  skipped: string[]
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
export function planWorkflow(plan: OrchestrationPlan) {
  return async ({ run, control, outputs }: OrchestrationContext): Promise<PlanWorkflowResult> => {
    const variables: Record<string, unknown> = {}
    const pending = new Map(plan.steps.map(step => [step.id, step]))
    const settled = new Set<string>()
    const skipped = new Set<string>()
    const running = new Map<string, Promise<void>>()

    const skip = (id: string): void => {
      skipped.add(id)
      settled.add(id)
      pending.delete(id)
    }

    /** The element list a `for_each` step expands over, or null when it is not a fan-out. */
    const expand = (step: PlannedStep): Instance[] | null => {
      if (step.forEach === undefined) {
        return null
      }
      const list = resolveValue(step.forEach, variables)
      if (!Array.isArray(list)) {
        const described = typeof step.forEach === 'string' ? step.forEach : JSON.stringify(step.forEach)
        throw new Error(
          `Step "${step.id}" iterates ${described}, which is ${list === undefined ? 'not available' : `a ${typeof list}`}. for_each needs an array.`
        )
      }
      return list.map((item, index) => ({
        id: `${step.id}[${index}]`,
        label: `${step.label} ${index + 1}/${list.length}`,
        scope: { ...variables, [step.forEachAs]: item },
      }))
    }

    /** Decide whether one instance runs: its gate, and whether its inputs can resolve at all. */
    const admit = async (step: PlannedStep, instance: Instance, dependsOn: string[]): Promise<boolean> => {
      const unresolvable = unresolvableGroups(step.inputs, instance.scope)
      if (unresolvable.length > 0) {
        return false
      }
      if (!step.condition) {
        return true
      }
      // The gate is a control node, so the decision appears in the graph next to the step it
      // governs instead of happening invisibly.
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

    /** Publish a step's exports. A fan-out collects one array per exported name, in element order. */
    const publish = (step: PlannedStep, results: { instance: Instance; result: OrchestrationStepResult }[]): void => {
      if (Object.keys(step.exports).length === 0) {
        return
      }
      if (!step.forEach) {
        const only = results[0]
        if (only) {
          Object.assign(variables, exportsFrom(step, only.result, outputs))
        }
        return
      }
      const collected: Record<string, unknown[]> = {}
      for (const variableName of Object.values(step.exports)) {
        collected[variableName] = []
      }
      for (const { result } of results) {
        const published = exportsFrom(step, result, outputs)
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

        const instances = expand(step) ?? [{ id: step.id, label: step.label, scope: variables }]
        const gateDependsOn = step.dependsOn.filter(id => !skipped.has(id))

        // A fan-out over an empty list is not a skip: downstream still gets an empty array, which
        // is a true answer rather than a missing one.
        if (step.forEach && instances.length === 0) {
          publish(step, [])
          settled.add(step.id)
          continue
        }

        const admitted: Instance[] = []
        for (const instance of instances) {
          if (await admit(step, instance, gateDependsOn)) {
            admitted.push(instance)
          }
        }

        if (admitted.length === 0) {
          skip(step.id)
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
                inputs: resolveValue(step.inputs, instance.scope) as Record<string, unknown>,
              }).then(result => ({ instance, result }))
            )
          ).then(results => {
            publish(step, results)
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

    return { variables, skipped: [...skipped] }
  }
}

export interface OrchestratePlanOptions extends OrchestrateOptions, PlanOptions {}

/**
 * Run the pipeline a `.deepnote` file defines, in Deepnote Cloud.
 *
 * This is the file-defined counterpart to `orchestrate`: same engine, same events, same graph —
 * the pipeline comes from a definition rather than from code.
 */
export async function orchestrateFile(
  file: DeepnoteFile,
  options: OrchestratePlanOptions & CloudExecutorOptions
): Promise<PlanRunResult<Record<string, unknown>>> {
  return runOrchestrationFile(file, options, createCloudStepExecutor(options))
}

/** Plan a `.deepnote` file and run it with a caller-supplied executor. */
export async function runOrchestrationFile(
  file: DeepnoteFile,
  options: OrchestratePlanOptions,
  execute: OrchestrationStepExecutor
): Promise<PlanRunResult<Record<string, unknown>>> {
  const plan = planOrchestration(file, options)
  const result = await runOrchestration(planWorkflow(plan), options, execute)
  return { ...result, value: result.value.variables, plan, skipped: result.value.skipped }
}
