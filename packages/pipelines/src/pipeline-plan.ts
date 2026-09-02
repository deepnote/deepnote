import type { DeepnoteBlock, DeepnoteFile, NotebookFunctionBlock, NotebookFunctionInput } from '@deepnote/blocks'
import { parseCondition } from './condition-expression'

/**
 * Read a pipeline out of a `.deepnote` file.
 *
 * The notebook marked `isPipeline: true` *is* the pipeline definition: each of its
 * `notebook-function` blocks names an external notebook, the inputs to run it with, and the values
 * it publishes. This module turns that into a dependency graph without executing anything.
 *
 * The encoding is the one deepnote.com stores for a notebook-function block, so the same file means
 * the same thing in the product and here. An input is either `{ variable_name }` — a reference to a
 * pipeline variable — or `{ custom_value }`, a literal. Exports are `{ enabled, variable_name }`.
 * The pipeline-only keys (`function_notebook_run_if`, `function_notebook_for_each`,
 * `function_notebook_for_each_as`, `function_notebook_allow_failure`) sit next to them.
 *
 * The pipeline notebook is read as a manifest, not run as a notebook. That distinction is the whole
 * point — Deepnote's own engine runs blocks strictly in order, so executing the parent would
 * serialize the pipeline and collapse it into a single run with a single status. Interpreting it
 * instead lets the pipeline run independent steps concurrently and report each one separately,
 * while the definition still lives in a versioned file that can be reviewed.
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
  /**
   * Input name → what to pass. A `variable_name` reads a pipeline variable (another step's export,
   * or this step's `forEachAs` element); a `custom_value` is passed as written.
   */
  inputs: Record<string, NotebookFunctionInput>
  /** Export name in the child's structured output → pipeline variable name. */
  exports: Record<string, string>
  /** Step ids this step reads a variable from, sorted. */
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
   * The pipeline variable holding the array this step iterates. The step becomes one run per
   * element, all concurrent.
   *
   * The width is not known until the array exists, so this is the one part of a plan that is
   * resolved at run time rather than at plan time.
   */
  forEach?: string
  /** The name each element is bound to inside this step's inputs and condition. */
  forEachAs: string
  /** Return a failed run as a result instead of failing the pipeline. */
  allowFailure: boolean
}

export interface PipelinePlan {
  /** The notebook the plan was read from. */
  notebookId: string
  notebookName: string
  steps: PlannedStep[]
  /** Pipeline variable name → the step id that publishes it. */
  producedBy: Record<string, string>
}

export interface PlanOptions {
  /** Which notebook in the file holds the pipeline, by id or name. Defaults to the one marked `isPipeline`. */
  notebook?: string
}

/** A pipeline variable name: a plain identifier, no paths. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Every `variable_name` an input consults, following its fallback chain. */
export function inputVariables(input: NotebookFunctionInput): string[] {
  const names: string[] = []
  for (let current: NotebookFunctionInput | undefined = input; current; current = current.fallback) {
    if (typeof current.variable_name === 'string' && current.variable_name !== '') {
      names.push(current.variable_name)
    }
  }
  return names
}

function isNotebookFunctionBlock(block: DeepnoteBlock): block is NotebookFunctionBlock {
  return block.type === 'notebook-function'
}

function selectNotebook(file: DeepnoteFile, options: PlanOptions) {
  const notebooks = file.project.notebooks
  if (options.notebook) {
    const named = notebooks.find(notebook => notebook.id === options.notebook || notebook.name === options.notebook)
    if (!named) {
      throw new Error(`No notebook with id or name "${options.notebook}" in this file.`)
    }
    return named
  }
  const marked = notebooks.filter(notebook => notebook.isPipeline)
  if (marked.length === 0) {
    throw new Error(
      'This file marks no notebook as the pipeline. Set `isPipeline: true` on the notebook whose notebook-function blocks are the steps, or name the notebook to run.'
    )
  }
  if (marked.length > 1) {
    throw new Error(
      `More than one notebook is marked isPipeline (${marked.map(n => `"${n.name}"`).join(', ')}). Mark exactly one, or name the notebook to run.`
    )
  }
  return marked[0]
}

/**
 * Build the dependency graph a `.deepnote` file describes.
 *
 * Dependencies are derived from variable flow rather than declared twice: a step whose input is
 * `{ variable_name: portfolio }` depends on whichever step exports `portfolio`. This is the same
 * model the reactivity package already applies to notebook-function blocks.
 */
export function planPipeline(file: DeepnoteFile, options: PlanOptions = {}): PipelinePlan {
  const notebook = selectNotebook(file, options)
  const blocks = [...notebook.blocks]
    .filter(isNotebookFunctionBlock)
    .sort((a, b) => a.sortingKey.localeCompare(b.sortingKey))
  if (blocks.length === 0) {
    throw new Error(
      `Notebook "${notebook.name}" is the pipeline but has no notebook-function blocks. Add one block per step, each naming the notebook it runs.`
    )
  }

  const producedBy: Record<string, string> = {}
  const drafts = blocks.map(block => {
    const metadata = block.metadata
    const notebookId = metadata.function_notebook_id
    if (!notebookId) {
      throw new Error(`Step "${block.id}" names no notebook. Set function_notebook_id to the notebook it should run.`)
    }
    const exports: Record<string, string> = {}
    for (const [exportName, mapping] of Object.entries(metadata.function_notebook_export_mappings ?? {})) {
      if (!mapping.enabled || !mapping.variable_name) {
        continue
      }
      assertIdentifier(mapping.variable_name, `Step "${block.id}" exports "${exportName}" as`)
      if (producedBy[mapping.variable_name]) {
        throw new Error(
          `Steps "${producedBy[mapping.variable_name]}" and "${block.id}" both export "${mapping.variable_name}". A variable can only come from one step.`
        )
      }
      producedBy[mapping.variable_name] = block.id
      exports[exportName] = mapping.variable_name
    }
    const condition = metadata.function_notebook_run_if?.trim() || undefined
    if (condition) {
      // Parse now so a malformed condition is a plan-time error, not a surprise mid-run.
      parseCondition(condition)
    }
    const forEach = metadata.function_notebook_for_each?.trim() || undefined
    if (forEach) {
      assertIdentifier(forEach, `Step "${block.id}" iterates`)
    }
    if (!forEach && metadata.function_notebook_for_each_as) {
      throw new Error(
        `Step "${block.id}" sets function_notebook_for_each_as but has no function_notebook_for_each to iterate.`
      )
    }
    const forEachAs = metadata.function_notebook_for_each_as?.trim() || 'item'
    if (forEach) {
      assertIdentifier(forEachAs, `Step "${block.id}" binds each element to`)
    }
    const inputs = metadata.function_notebook_inputs ?? {}
    for (const [inputName, input] of Object.entries(inputs)) {
      for (const name of inputVariables(input)) {
        assertIdentifier(name, `Step "${block.id}" input "${inputName}" reads`)
      }
    }
    return {
      id: block.id,
      label: (metadata.name as string | undefined)?.trim() || block.id,
      notebookId,
      inputs,
      exports,
      condition,
      forEach,
      forEachAs,
      allowFailure: metadata.function_notebook_allow_failure === true,
    }
  })

  const steps: PlannedStep[] = drafts.map(draft => {
    // The loop variable is bound by the step itself, so it is not a dependency on anything.
    const bound = draft.forEach ? draft.forEachAs : undefined
    if (bound && producedBy[bound]) {
      throw new Error(
        `Step "${draft.id}" binds each element to "${bound}", which step "${producedBy[bound]}" also exports. Pick a name no step exports.`
      )
    }
    // Inputs, fallbacks, the condition and the for_each all read variables, so the step depends on
    // whatever any of them consults — otherwise the gate could be evaluated, or the fan-out sized,
    // before those values exist. A fallback counts too: which alternative wins is a run-time fact.
    const names = new Set<string>()
    for (const input of Object.values(draft.inputs)) {
      for (const name of inputVariables(input)) {
        names.add(name)
      }
    }
    if (draft.forEach) {
      names.add(draft.forEach)
    }
    if (draft.condition) {
      for (const name of parseCondition(draft.condition).references) {
        names.add(name)
      }
    }
    if (bound) {
      names.delete(bound)
    }

    const dependsOn = new Set<string>()
    for (const name of names) {
      const producer = producedBy[name]
      if (!producer) {
        throw new Error(
          `Step "${draft.id}" reads "${name}", which no step exports. Check the export mappings of the step that should produce it.`
        )
      }
      if (producer === draft.id) {
        throw new Error(`Step "${draft.id}" reads "${name}", which it exports itself.`)
      }
      dependsOn.add(producer)
    }
    return { ...draft, dependsOn: [...dependsOn].sort() }
  })

  assertAcyclic(steps)
  return { notebookId: notebook.id, notebookName: notebook.name, steps, producedBy }
}

function assertIdentifier(name: string, context: string): void {
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `${context} "${name}", which is not a plain variable name. Variables are referenced by name only: read a field in a run_if condition, or export the field from the step that produces it.`
    )
  }
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
