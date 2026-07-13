import type { InputBlock, InputBlockValueOverride } from '@deepnote/blocks'
import { getInputBlockValueOverrideValidationError, InvalidValueError } from '@deepnote/blocks'

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
