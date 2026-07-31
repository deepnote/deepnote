import type { DeepnoteFile, InputBlock, InputBlockValueOverride } from '@deepnote/blocks'
import { getInputBlockValueOverrideValidationError, InvalidValueError, isInputBlock } from '@deepnote/blocks'

/** The notebooks of a file — the unit input handling is scoped to. */
type Notebooks = DeepnoteFile['project']['notebooks']

/**
 * Which notebook an input override applies to. A run executes exactly one notebook (`--notebook`
 * locally, a `notebookId` in the cloud) or the whole file, and each override must be coerced against
 * the input blocks of *that* scope — otherwise a value shaped for one notebook's block could be
 * applied to a same-named block of a different type elsewhere, or mutate a notebook that isn't run.
 */
export interface InputScope {
  /** Restrict to the notebook with this name (matches the engine's `notebookName` scoping). */
  notebook?: string
  /** Restrict to the notebook with this id (the cloud run target). */
  notebookId?: string
}

/**
 * The notebooks in scope: the one matching `notebookId`, else the one matching `notebook`, else all.
 * An unmatched `notebookId` falls back to every notebook (best-effort typing when the run targets a
 * cloud id not present in the local file); an unmatched `notebook` name yields none (the engine then
 * raises its own "notebook not found").
 */
export function notebooksInScope(file: DeepnoteFile, scope: InputScope = {}): Notebooks {
  if (scope.notebookId !== undefined) {
    const matched = file.project.notebooks.filter(notebook => notebook.id === scope.notebookId)
    return matched.length > 0 ? matched : file.project.notebooks
  }
  if (scope.notebook !== undefined) {
    return file.project.notebooks.filter(notebook => notebook.name === scope.notebook)
  }
  return file.project.notebooks
}

/**
 * The given notebooks' input blocks, grouped by variable name — the lookup both the local and the
 * cloud path need, so they cannot drift. A name can be defined by more than one block, and every one
 * of them has to be overridden, so this maps to a list rather than a single block. Pass the notebooks
 * already narrowed to the run's scope (see {@link notebooksInScope}).
 */
export function inputBlocksByName(notebooks: Notebooks): Map<string, InputBlock[]> {
  const byName = new Map<string, InputBlock[]>()
  for (const notebook of notebooks) {
    for (const block of notebook.blocks) {
      if (!isInputBlock(block)) continue
      const name = block.metadata.deepnote_variable_name
      if (!name) continue
      const blocks = byName.get(name)
      if (blocks) {
        blocks.push(block)
      } else {
        byName.set(name, [block])
      }
    }
  }
  return byName
}

/**
 * Coerce `value` to the schema shape a set of same-named input blocks require. Coerces against the
 * first block, then requires the result to be valid for every other block in the set — so a value
 * shaped for one block can never be injected into a sibling of a different type. `blocks` must be
 * non-empty.
 *
 * @throws {InvalidValueError} when the name is defined by blocks of incompatible types in scope, or
 *   the value cannot be coerced to the block's shape.
 */
export function coerceInputValueForBlocks(blocks: InputBlock[], value: unknown): InputBlockValueOverride {
  const coerced = coerceInputValue(blocks[0], value)
  for (let i = 1; i < blocks.length; i++) {
    if (getInputBlockValueOverrideValidationError(blocks[i], coerced)) {
      throw new InvalidValueError(
        `Input "${blocks[0].metadata.deepnote_variable_name}" is defined by input blocks of different types in the notebook(s) being run, so one value cannot satisfy all of them. Run a single notebook, or make the definitions consistent.`,
        { value }
      )
    }
  }
  return coerced
}

/**
 * Coerce a value to the schema shape its input block requires — e.g. a slider value is stored
 * as a string, not a number, or the file/snapshot schema rejects it.
 *
 * The CLI requires callers to pass already-schema-shaped values and rejects anything else. This
 * library is driven by a UI instead: a range control yields a number, a checkbox a boolean, a
 * multi-select an array. Coercing at that boundary is what lets those native values through,
 * and the result is what both the persisted file and the kernel see (`ExecutionEngine` validates
 * overrides against the same contract).
 *
 * It does NOT validate a value against a select's allowed options, a slider's range, or a date's
 * format; those remain the caller's concern.
 *
 * @throws {InvalidValueError} for a checkbox value that is not an unambiguous boolean, a
 *   date-range array that is not exactly `[start, end]`, or a value that cannot be coerced into
 *   the shape the block requires.
 */
export function coerceInputValue(block: InputBlock, value: unknown): InputBlockValueOverride {
  const coerced = coerce(block, value)

  // Belt and braces: the engine validates overrides against this same contract before it applies
  // them, so anything we hand back must already satisfy it.
  const validationError = getInputBlockValueOverrideValidationError(block, coerced)
  if (validationError) {
    throw new InvalidValueError(`Input "${block.metadata.deepnote_variable_name}" ${validationError}`, { value })
  }

  return coerced
}

function coerce(block: InputBlock, value: unknown): InputBlockValueOverride {
  switch (block.type) {
    case 'input-checkbox':
      return coerceCheckboxValue(value)

    case 'input-select': {
      if (block.metadata.deepnote_allow_multiple_values === true) {
        if (Array.isArray(value)) return value.map(coerceToInputString)
        if (value === null || value === undefined || value === '') return []
        return [coerceToInputString(value)]
      }
      if (Array.isArray(value)) return value.length > 0 ? coerceToInputString(value[0]) : ''
      return coerceToInputString(value)
    }

    case 'input-date-range': {
      if (Array.isArray(value)) {
        if (value.length !== 2) {
          throw new InvalidValueError(
            `Invalid date-range value: expected exactly two elements [start, end], received ${value.length}.`,
            { value }
          )
        }
        return [coerceToInputString(value[0]), coerceToInputString(value[1])]
      }
      return coerceToInputString(value)
    }

    default:
      return coerceToInputString(value)
  }
}

/** Coerce a scalar to the string form input schemas expect; nullish becomes `''`. */
function coerceToInputString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Coerce a value to a checkbox boolean, accepting only unambiguous inputs: `true`/`false`,
 * `1`/`0`, and `"true"`/`"false"` (case-insensitive). Anything else throws rather than silently
 * defaulting (avoids `Boolean('false') === true`).
 */
function coerceCheckboxValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new InvalidValueError(
    `Invalid checkbox value: ${JSON.stringify(value)}. Expected true/false, 1/0, or "true"/"false".`,
    { value }
  )
}
