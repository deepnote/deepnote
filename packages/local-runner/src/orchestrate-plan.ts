import type { DeepnoteFile } from '@deepnote/blocks'
import { evaluateCondition } from './condition-expression'
import type {
  OrchestrateOptions,
  OrchestrationContext,
  OrchestrationResult,
  OrchestrationStepExecutor,
  OrchestrationStepResult,
} from './orchestrate-core'
import { runOrchestration } from './orchestrate-core'
import type { OrchestrationPlan, PlanOptions } from './orchestration-plan'
import { planOrchestration, resolveValue } from './orchestration-plan'

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

    while (settled.size < plan.steps.length) {
      const ready = [...pending.values()].filter(step => step.dependsOn.every(id => settled.has(id)))

      if (ready.length === 0 && running.size === 0) {
        // Guarded against at plan time; reaching it means a step never settled.
        throw new Error('The pipeline stalled: no step is ready and none is running.')
      }

      for (const step of ready) {
        // A step reading a skipped step's export can never have its inputs resolved, so it is
        // skipped too rather than run with a missing value.
        if (step.dependsOn.some(id => skipped.has(id))) {
          skip(step.id)
          continue
        }

        pending.delete(step.id)

        // The gate is a control node, so the decision appears in the graph next to the step it
        // governs instead of happening invisibly.
        const gate = step.condition
          ? await control(
              {
                id: `${step.id}-gate`,
                kind: 'gate',
                label: step.condition,
                dependsOn: step.dependsOn,
                metadata: { condition: step.condition },
              },
              () => evaluateCondition(step.condition as string, variables)
            )
          : true

        if (!gate) {
          skip(step.id)
          continue
        }

        running.set(
          step.id,
          run({
            id: step.id,
            label: step.label,
            notebookId: step.notebookId,
            dependsOn: step.condition ? [`${step.id}-gate`] : step.dependsOn,
            inputs: resolveValue(step.inputs, variables) as Record<string, unknown>,
          }).then(result => {
            Object.assign(variables, exportsFrom(step, result, outputs))
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

/** Plan a `.deepnote` file and run it with a caller-supplied executor. */
export async function orchestrateFile(
  file: DeepnoteFile,
  options: OrchestratePlanOptions,
  execute: OrchestrationStepExecutor
): Promise<PlanRunResult<Record<string, unknown>>> {
  const plan = planOrchestration(file, options)
  const result = await runOrchestration(planWorkflow(plan), options, execute)
  return { ...result, value: result.value.variables, plan, skipped: result.value.skipped }
}
