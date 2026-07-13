import type { DeepnoteFile, InputBlockValueOverrides } from '@deepnote/blocks'
import { coerceInputValue, inputBlocksByName } from './coerce-input-value'

/**
 * Apply input overrides to a file's input blocks, in place.
 *
 * Each value is coerced to the schema shape its input type requires, so the mutated file still
 * serializes for snapshots — e.g. a slider value is stored as a string, not a number.
 *
 * Returns the coerced values, keyed by variable name. Pass these — not the raw values — to
 * `ExecutionEngine`, which validates overrides against the input block's schema shape before
 * applying them. Names with no matching input block are not coerced and are not returned.
 */
export function applyInputOverrides(file: DeepnoteFile, inputs: Record<string, unknown>): InputBlockValueOverrides {
  const coerced: InputBlockValueOverrides = {}
  if (Object.keys(inputs).length === 0) return coerced

  for (const [name, blocks] of inputBlocksByName(file)) {
    if (!Object.hasOwn(inputs, name)) continue

    for (const block of blocks) {
      const value = coerceInputValue(block, inputs[name])
      block.metadata.deepnote_variable_value = value as typeof block.metadata.deepnote_variable_value
      coerced[name] = value
    }
  }

  return coerced
}

/** Metadata a UI needs to render an editable control for one input block. */
export interface InputBlockInfo {
  variableName: string
  type: string
  label?: string
  value: unknown
  /** Select: the allowed options. */
  options?: string[]
  /** Select: whether multiple values may be chosen. */
  multiple?: boolean
  /** Slider: lower bound. */
  min?: number
  /** Slider: upper bound. */
  max?: number
  /** Slider: step size. */
  step?: number
}

/**
 * List the input blocks in a file, in document order, with enough per-type metadata for a UI to
 * render a control (slider bounds, select options) without re-parsing the file.
 */
export function listInputBlocks(file: DeepnoteFile): InputBlockInfo[] {
  const inputs: InputBlockInfo[] = []
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!block.type.startsWith('input-')) continue
      const metadata = block.metadata as Record<string, unknown>
      const variableName = metadata.deepnote_variable_name as string | undefined
      if (!variableName) continue
      const info: InputBlockInfo = {
        variableName,
        type: block.type,
        label: metadata.deepnote_input_label as string | undefined,
        value: metadata.deepnote_variable_value,
      }
      if (block.type === 'input-select') {
        info.options = metadata.deepnote_variable_options as string[] | undefined
        info.multiple = metadata.deepnote_allow_multiple_values === true
      } else if (block.type === 'input-slider') {
        info.min = metadata.deepnote_slider_min_value as number | undefined
        info.max = metadata.deepnote_slider_max_value as number | undefined
        info.step = metadata.deepnote_slider_step as number | undefined
      }
      inputs.push(info)
    }
  }
  return inputs
}
