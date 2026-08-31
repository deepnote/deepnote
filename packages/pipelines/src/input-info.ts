import type { DeepnoteBlock } from '@deepnote/blocks'

/**
 * What a UI needs to render (or describe) one input block.
 *
 * Its own module because two very different readers want it: `listInputBlocks` walks a whole file to
 * build editable controls, and `toSnapshotView` describes the values a finished run used. Keeping
 * the extraction here means `snapshot-view.ts` — which bundles for the browser — doesn't have to
 * import the override and coercion machinery to get at it.
 */
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
 * Read one input block's metadata, or undefined if it isn't an input (or has no variable name — an
 * input nothing can refer to is not something a UI can render).
 *
 * The per-type fields are the ones that carry meaning a value alone can't: a slider's `6` says
 * nothing without `3–12`, and a select's value says nothing without its options.
 */
export function inputInfoFor(block: DeepnoteBlock): InputBlockInfo | undefined {
  if (!block.type.startsWith('input-')) {
    return undefined
  }
  const metadata = block.metadata as Record<string, unknown> | undefined
  const variableName = metadata?.deepnote_variable_name as string | undefined
  if (!variableName) {
    return undefined
  }

  const info: InputBlockInfo = {
    variableName,
    type: block.type,
    label: metadata?.deepnote_input_label as string | undefined,
    value: metadata?.deepnote_variable_value,
  }
  if (block.type === 'input-select') {
    info.options = metadata?.deepnote_variable_options as string[] | undefined
    info.multiple = metadata?.deepnote_allow_multiple_values === true
  } else if (block.type === 'input-slider') {
    info.min = metadata?.deepnote_slider_min_value as number | undefined
    info.max = metadata?.deepnote_slider_max_value as number | undefined
    info.step = metadata?.deepnote_slider_step as number | undefined
  }
  return info
}
