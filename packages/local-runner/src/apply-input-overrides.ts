import type { DeepnoteFile, InputBlock, InputBlockValueOverride, InputBlockValueOverrides } from '@deepnote/blocks'
import type { InputScope } from './coerce-input-value'
import { coerceInputValueForBlocks, inputBlocksByName, notebooksInScope } from './coerce-input-value'
import type { InputBlockInfo } from './input-info'
import { inputInfoFor } from './input-info'

export type { InputBlockInfo } from './input-info'

/**
 * Apply input overrides to a file's input blocks, in place.
 *
 * Each value is coerced to the schema shape its input type requires, so the mutated file still
 * serializes for snapshots — e.g. a slider value is stored as a string, not a number.
 *
 * Pass `scope` to restrict coercion and mutation to the notebook that will run — without it a value
 * meant for one notebook's block could be coerced against, and mutate, a same-named block of a
 * different type in a notebook that isn't being run. Defaults to the whole file (every notebook).
 *
 * Application is atomic: every value is coerced and validated before any block is mutated, so a
 * failing override leaves the file unchanged rather than partially applied.
 *
 * Returns the coerced values, keyed by variable name. Pass these — not the raw values — to
 * `ExecutionEngine`, which validates overrides against the input block's schema shape before
 * applying them. Names with no in-scope input block are not coerced and are not returned.
 */
export function applyInputOverrides(
  file: DeepnoteFile,
  inputs: Record<string, unknown>,
  scope: InputScope = {}
): InputBlockValueOverrides {
  const coerced: InputBlockValueOverrides = {}
  if (Object.keys(inputs).length === 0) return coerced

  const byName = inputBlocksByName(notebooksInScope(file, scope))

  // First pass: coerce and validate everything. A failure here throws before any block is touched.
  const pending: Array<{ name: string; blocks: InputBlock[]; value: InputBlockValueOverride }> = []
  for (const [name, rawValue] of Object.entries(inputs)) {
    const blocks = byName.get(name)
    if (!blocks) continue
    pending.push({ name, blocks, value: coerceInputValueForBlocks(blocks, rawValue) })
  }

  // Second pass: apply. Reached only once every override coerced successfully.
  for (const { name, blocks, value } of pending) {
    for (const block of blocks) {
      block.metadata.deepnote_variable_value = value as typeof block.metadata.deepnote_variable_value
    }
    coerced[name] = value
  }

  return coerced
}

/**
 * List the input blocks in a file, in document order, with enough per-type metadata for a UI to
 * render a control (slider bounds, select options) without re-parsing the file.
 *
 * The per-block read lives in `input-info.ts` so a snapshot can describe its inputs with the same
 * fields — see {@link inputInfoFor}.
 */
export function listInputBlocks(file: DeepnoteFile): InputBlockInfo[] {
  const inputs: InputBlockInfo[] = []
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      const info = inputInfoFor(block)
      if (info) inputs.push(info)
    }
  }
  return inputs
}
