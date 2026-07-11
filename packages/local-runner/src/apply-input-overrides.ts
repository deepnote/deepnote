import type { DeepnoteFile } from '@deepnote/blocks'
import { coerceInputVariableValue } from '@deepnote/blocks'

/**
 * Apply input overrides to a file's input blocks, in place.
 *
 * Each value is coerced to the schema shape its input type requires (via
 * `coerceInputVariableValue` from `@deepnote/blocks`), so the mutated file still serializes
 * for snapshots — e.g. a slider value is stored as a string, not a number.
 *
 * NOTE: this mirrors the CLI's `applyInputOverrides`. The load-bearing part (coercion) is
 * shared from `@deepnote/blocks`; this thin loop is duplicated for now and is a candidate to
 * hoist into `@deepnote/blocks` in a follow-up.
 */
export function applyInputOverrides(file: DeepnoteFile, inputs: Record<string, unknown>): void {
  if (Object.keys(inputs).length === 0) return
  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      if (!block.type.startsWith('input-')) continue
      const metadata = block.metadata as Record<string, unknown>
      const name = metadata.deepnote_variable_name as string | undefined
      if (name && Object.hasOwn(inputs, name)) {
        metadata.deepnote_variable_value = coerceInputVariableValue(block, inputs[name])
      }
    }
  }
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
