import type { DeepnoteFile, InputBlock, InputBlockValueOverride, InputBlockValueOverrides } from '@deepnote/blocks'
import { getInputBlockValueOverrideValidationError, isInputBlock } from '@deepnote/blocks'
import { getNotebooksForExecutionScope } from './notebook-scope'

/** Error thrown when a provided input does not match the referenced input block. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

/**
 * Parse CLI input flags according to the referenced input block types.
 *
 * Shared by the local `run` command and the cloud `run --cloud` path (`utils/run-in-cloud.ts`), so
 * `--input` means the same thing either way: a value is typed by the block it names
 * (`true`/`false` for a checkbox, a JSON string array for a multi-select, a plain string
 * otherwise), and unknown names or values the block cannot store are rejected.
 */
export function parseInputs(
  file: DeepnoteFile,
  inputFlags: string[] | undefined,
  notebookName?: string
): InputBlockValueOverrides {
  if (!inputFlags || inputFlags.length === 0) {
    return {}
  }

  const inputBlocks = getInputBlocks(file, notebookName)
  const inputs: InputBlockValueOverrides = Object.create(null) as InputBlockValueOverrides

  for (const flag of inputFlags) {
    const eqIndex = flag.indexOf('=')
    if (eqIndex === -1) {
      throw new Error(`Invalid input format: "${flag}". Expected key=value`)
    }

    const key = flag.slice(0, eqIndex).trim()
    const rawValue = flag.slice(eqIndex + 1)

    if (!key) {
      throw new Error(`Invalid input: empty key in "${flag}"`)
    }

    const firstMatchingBlock = inputBlocks.find(block => block.metadata.deepnote_variable_name === key)
    if (!firstMatchingBlock) {
      throw new InvalidInputError(`Input "${key}" is not defined for the selected notebook scope`)
    }

    const value = parseInputValue(firstMatchingBlock, rawValue)
    for (const block of inputBlocks) {
      if (block.metadata.deepnote_variable_name !== key) {
        continue
      }

      const validationError = getInputBlockValueOverrideValidationError(block, value)
      if (validationError) {
        throw new InvalidInputError(`Input "${key}" ${validationError}`)
      }
    }

    inputs[key] = value
  }

  return inputs
}

/** The input blocks in scope for a run, in document order. */
export function getInputBlocks(file: DeepnoteFile, notebookName?: string): InputBlock[] {
  return getNotebooksForExecutionScope(file, { notebook: notebookName }).flatMap(notebook =>
    notebook.blocks.filter(isInputBlock)
  )
}

function parseInputValue(block: InputBlock, rawValue: string): InputBlockValueOverride {
  let value: unknown = rawValue

  if (block.type === 'input-checkbox') {
    if (rawValue === 'true') value = true
    if (rawValue === 'false') value = false
  } else if (block.type === 'input-select' && block.metadata.deepnote_allow_multiple_values === true) {
    value = parseJsonValue(rawValue)
  } else if (block.type === 'input-date-range') {
    const parsed = parseJsonValue(rawValue)
    value = Array.isArray(parsed) ? parsed : rawValue
  }

  return value as InputBlockValueOverride
}

function parseJsonValue(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}
