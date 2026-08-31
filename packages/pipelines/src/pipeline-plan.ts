import type { DeepnoteBlock, DeepnoteFile, NotebookFunctionBlock } from '@deepnote/blocks'
import { parseCondition } from './condition-expression'
import { referenceRoots } from './reference-expression'

/**
 * Read a pipeline out of a `.deepnote` file.
 *
 * A parent notebook of `notebook-function` blocks *is* a pipeline definition: each block names an
 * external notebook, the inputs to run it with, and the values it publishes. This module turns that
 * into a dependency graph without executing anything.
 *
 * The parent is read as a manifest, not run as a notebook. That distinction is the whole point —
 * Deepnote's own engine runs blocks strictly in order, so executing the parent would serialize the
 * pipeline and collapse it into a single run with a single status. Interpreting it instead lets the
 * pipeline run independent steps concurrently and report each one separately, while the
 * definition still lives in a versioned file that can be reviewed, rather than in application code.
 *
 * Nothing here is Node-specific, so a browser can plan a pipeline it fetched.
 */

/** A step's inputs and exports, resolved from one `notebook-function` block. */
export interface PlannedStep {
  /** The block id, used as the pipeline step id. */
  id: string
  label: string
  /** The external notebook this step runs. */
  notebookId: string
  /** Literal inputs, plus `{{variable}}` references to earlier steps' exports. */
  inputs: Record<string, unknown>
  /** Export name in the child's structured output → local variable name. */
  exports: Record<string, string>
  /** Step ids this step reads a variable from. */
  dependsOn: string[]
  /**
   * A `run_if` condition. When it evaluates false the step is skipped, and so is anything that
   * reads what it would have exported.
   *
   * This is what lets a gate live in the file rather than in application code: the step's
   * *existence* becomes a function of an earlier step's result.
   *
   * On a {@link forEach} step it is evaluated per element, which is how a file expresses "recover
   * only the regions that failed the gate".
   */
  condition?: string
  /**
   * What the step iterates: a reference to an array (`{{regions}}`), or a list written inline whose
   * items may themselves be references. The step becomes one run per element, all concurrent.
   *
   * The width is not known until the array exists, so this is the one part of a plan that is
   * resolved at run time rather than at plan time.
   */
  forEach?: unknown
  /** The name each element is bound to inside this step's inputs and condition. */
  forEachAs: string
}

export interface PipelinePlan {
  /** The notebook the plan was read from. */
  notebookId: string
  notebookName: string
  steps: PlannedStep[]
  /** Local variable name → the step id that publishes it. */
  producedBy: Record<string, string>
}

export interface PlanOptions {
  /** Which notebook in the file holds the pipeline. Defaults to the only one that has steps. */
  notebook?: string
}

function isNotebookFunctionBlock(block: DeepnoteBlock): block is NotebookFunctionBlock {
  return block.type === 'notebook-function'
}

function selectNotebook(file: DeepnoteFile, options: PlanOptions) {
  const notebooks = file.project.notebooks
  if (options.notebook) {
    const named = notebooks.find(notebook => notebook.name === options.notebook || notebook.id === options.notebook)
    if (!named) {
      throw new Error(`No notebook named "${options.notebook}" in this file.`)
    }
    return named
  }
  const withSteps = notebooks.filter(notebook => notebook.blocks.some(isNotebookFunctionBlock))
  if (withSteps.length === 0) {
    throw new Error(
      'This file defines no pipeline: no notebook in it has a notebook-function block. Add one block per step, each naming the notebook it runs.'
    )
  }
  if (withSteps.length > 1) {
    throw new Error(
      `More than one notebook defines steps (${withSteps.map(n => `"${n.name}"`).join(', ')}). Name the one to run.`
    )
  }
  return withSteps[0]
}

/**
 * Build the dependency graph a `.deepnote` file describes.
 *
 * Dependencies are derived from variable flow rather than declared twice: a step that reads
 * `{{portfolio}}` depends on whichever step exports `portfolio`. This is the same model the
 * reactivity package already applies to notebook-function blocks.
 */
export function planPipeline(file: DeepnoteFile, options: PlanOptions = {}): PipelinePlan {
  const notebook = selectNotebook(file, options)
  const blocks = [...notebook.blocks]
    .filter(isNotebookFunctionBlock)
    .sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))

  const producedBy: Record<string, string> = {}
  const drafts = blocks.map(block => {
    const notebookId = block.metadata?.function_notebook_id
    if (!notebookId) {
      throw new Error(`Step "${block.id}" names no notebook. Set function_notebook_id to the notebook it should run.`)
    }
    const exports: Record<string, string> = {}
    for (const [exportName, mapping] of Object.entries(block.metadata?.function_notebook_export_mappings ?? {})) {
      const entry = mapping as { enabled?: boolean; variable_name?: string }
      if (entry?.enabled === false || !entry?.variable_name) {
        continue
      }
      if (producedBy[entry.variable_name]) {
        throw new Error(
          `Steps "${producedBy[entry.variable_name]}" and "${block.id}" both export "${entry.variable_name}". A variable can only come from one step.`
        )
      }
      producedBy[entry.variable_name] = block.id
      exports[exportName] = entry.variable_name
    }
    const condition = (block.metadata?.run_if as string | undefined)?.trim() || undefined
    if (condition) {
      // Parse now so a malformed condition is a plan-time error, not a surprise mid-run.
      parseCondition(condition)
    }
    const rawForEach = block.metadata?.for_each
    const forEach = typeof rawForEach === 'string' ? rawForEach.trim() || undefined : (rawForEach ?? undefined)
    const forEachAs = (block.metadata?.for_each_as as string | undefined)?.trim() || 'item'
    if (!forEach && block.metadata?.for_each_as) {
      throw new Error(`Step "${block.id}" sets for_each_as but has no for_each to iterate.`)
    }
    return {
      id: block.id,
      label: (block.metadata?.name as string | undefined)?.trim() || block.id,
      notebookId,
      inputs: (block.metadata?.function_notebook_inputs ?? {}) as Record<string, unknown>,
      exports,
      condition,
      forEach,
      forEachAs,
    }
  })

  const steps: PlannedStep[] = drafts.map(draft => {
    const dependsOn = new Set<string>()
    // The loop variable is bound by the step itself, so it is not a dependency on anything.
    const bound = draft.forEach ? new Set([draft.forEachAs]) : new Set<string>()
    // A condition and a for_each read variables too, so the step depends on whatever they consult —
    // otherwise the gate could be evaluated, or the fan-out sized, before those values exist.
    const names = new Set([
      ...referenceRoots(draft.inputs, bound),
      ...referenceRoots(draft.forEach, bound),
      ...[...(draft.condition ? parseCondition(draft.condition).references : [])].filter(name => !bound.has(name)),
    ])
    for (const name of names) {
      const producer = producedBy[name]
      if (!producer) {
        throw new Error(
          `Step "${draft.id}" reads "{{${name}}}", which no step exports. Check the export mappings of the step that should produce it.`
        )
      }
      if (producer === draft.id) {
        throw new Error(`Step "${draft.id}" reads "{{${name}}}", which it exports itself.`)
      }
      dependsOn.add(producer)
    }
    return { ...draft, dependsOn: [...dependsOn] }
  })

  assertAcyclic(steps)
  return { notebookId: notebook.id, notebookName: notebook.name, steps, producedBy }
}

/** A cycle would deadlock the scheduler, so it is worth naming before anything runs. */
function assertAcyclic(steps: PlannedStep[]): void {
  const byId = new Map(steps.map(step => [step.id, step]))
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string, trail: string[]): void => {
    const status = state.get(id)
    if (status === 'done') {
      return
    }
    if (status === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(id)), id]
      throw new Error(`These steps depend on each other in a cycle: ${cycle.join(' → ')}.`)
    }
    state.set(id, 'visiting')
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      visit(dependency, [...trail, id])
    }
    state.set(id, 'done')
  }

  for (const step of steps) {
    visit(step.id, [])
  }
}
