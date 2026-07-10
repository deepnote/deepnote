import { dedent } from 'ts-dedent'

import type {
  DeepnoteBlock,
  InputBlock,
  InputCheckboxBlock,
  InputDateBlock,
  InputDateRangeBlock,
  InputFileBlock,
  InputSelectBlock,
  InputSliderBlock,
  InputTextareaBlock,
  InputTextBlock,
} from '../deepnote-file/deepnote-file-schema'
import { InvalidValueError } from '../errors'
import { pythonCode } from '../python-snippets'
import { escapePythonString, sanitizePythonVariableName } from './python-utils'

// Date range types and utilities
export type DateTimeString = string
export type DateTimeStringArray = [DateTimeString, DateTimeString]
export type DateIntervalCustomString = `customDays${number}`
export type DateIntervalString =
  | DateIntervalCustomString
  | 'past7days'
  | 'past14days'
  | 'pastMonth'
  | 'past3months'
  | 'past6months'
  | 'pastYear'
export type DateRangeInputValue = DateTimeString | DateTimeStringArray | DateIntervalString

export const DATE_RANGE_INPUT_RELATIVE_RANGES = [
  { value: 'past7days', pythonCode: pythonCode.dateRangePast7days },
  { value: 'past14days', pythonCode: pythonCode.dateRangePast14days },
  { value: 'pastMonth', pythonCode: pythonCode.dateRangePastMonth },
  { value: 'past3months', pythonCode: pythonCode.dateRangePast3months },
  { value: 'past6months', pythonCode: pythonCode.dateRangePast6months },
  { value: 'pastYear', pythonCode: pythonCode.dateRangePastYear },
] as const

export function isCustomDateRange(value: DateRangeInputValue): value is DateIntervalCustomString {
  if (typeof value !== 'string') {
    return false
  }

  const days = Number.parseInt(value.split('customDays')[1] ?? '0', 10)

  return value.startsWith('customDays') && !Number.isNaN(days) && days >= 0
}

export function isValidRelativeDateInterval(value: DateRangeInputValue): value is DateIntervalString {
  return typeof value === 'string' && DATE_RANGE_INPUT_RELATIVE_RANGES.some(range => range.value === value)
}

export function isValidAbsoluteDateRange(value: DateRangeInputValue): value is DateTimeStringArray {
  const YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(v => typeof v === 'string' && (v === '' || YYYY_MM_DD_REGEX.test(v)))
  )
}

// Python code generation functions
export function createPythonCodeForInputTextBlock(block: InputTextBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  return `${sanitizedPythonVariableName} = ${escapePythonString(block.metadata.deepnote_variable_value)}`
}

export function createPythonCodeForInputTextareaBlock(block: InputTextareaBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  return `${sanitizedPythonVariableName} = ${escapePythonString(block.metadata.deepnote_variable_value)}`
}

export function createPythonCodeForInputCheckboxBlock(block: InputCheckboxBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  return `${sanitizedPythonVariableName} = ${block.metadata.deepnote_variable_value ? 'True' : 'False'}`
}

export function createPythonCodeForInputSelectBlock(block: InputSelectBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)

  if (block.metadata.deepnote_allow_multiple_values || Array.isArray(block.metadata.deepnote_variable_value)) {
    const values = Array.isArray(block.metadata.deepnote_variable_value)
      ? block.metadata.deepnote_variable_value
      : [block.metadata.deepnote_variable_value]
    return `${sanitizedPythonVariableName} = [${values.map(value => escapePythonString(value)).join(', ')}]`
  } else if (!block.metadata.deepnote_allow_multiple_values && !block.metadata.deepnote_variable_value) {
    return `${sanitizedPythonVariableName} = None`
  } else {
    return `${sanitizedPythonVariableName} = ${escapePythonString(block.metadata.deepnote_variable_value)}`
  }
}

export function createPythonCodeForInputSliderBlock(block: InputSliderBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  const value = block.metadata.deepnote_variable_value

  // Validate that the value is a valid numeric literal
  // Allow integers, floats with optional sign and decimal point
  const numericPattern = /^-?\d+\.?\d*$|^-?\d*\.\d+$/
  if (!numericPattern.test(value)) {
    throw new InvalidValueError(
      `Invalid numeric value for slider input: "${value}". Expected a valid number (integer or float).`,
      { value }
    )
  }

  // Parse and convert to number to ensure it's valid, then back to string for output
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    throw new InvalidValueError(`Invalid numeric value for slider input: "${value}". Value must be finite.`, { value })
  }

  return `${sanitizedPythonVariableName} = ${numericValue}`
}

export function createPythonCodeForInputFileBlock(block: InputFileBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  if (block.metadata.deepnote_variable_value === '') {
    return `${sanitizedPythonVariableName} = None`
  }
  return `${sanitizedPythonVariableName} = ${escapePythonString(block.metadata.deepnote_variable_value)}`
}

export function createPythonCodeForInputDateBlock(block: InputDateBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)
  const escapedValue = escapePythonString(block.metadata.deepnote_variable_value)

  if (!block.metadata.deepnote_variable_value) {
    return `
${sanitizedPythonVariableName} = None
`
  }

  if (block.metadata.deepnote_input_date_version === 2) {
    return `
from dateutil.parser import parse as _deepnote_parse
${sanitizedPythonVariableName} = _deepnote_parse(${escapedValue}).date()
`
  }
  return `
from datetime import datetime as _deepnote_datetime
${sanitizedPythonVariableName} = _deepnote_datetime.strptime(${escapedValue}, "%Y-%m-%dT%H:%M:%S.%fZ")
`
}

export function createPythonCodeForInputDateRangeBlock(block: InputDateRangeBlock): string {
  const sanitizedPythonVariableName = sanitizePythonVariableName(block.metadata.deepnote_variable_name)

  // Case 1: An absolute date range. Empty strings are allowed and their Python values set to None.
  if (isValidAbsoluteDateRange(block.metadata.deepnote_variable_value)) {
    const startDate = block.metadata.deepnote_variable_value[0]
    const endDate = block.metadata.deepnote_variable_value[1]

    return pythonCode.dateRangeAbsolute(sanitizedPythonVariableName, startDate, endDate)
  }
  // Case 2: A custom date range. E.g. 'customDays14'
  else if (isCustomDateRange(block.metadata.deepnote_variable_value)) {
    const customDays = block.metadata.deepnote_variable_value.replace('customDays', '')
    return pythonCode.dateRangeCustomDays(sanitizedPythonVariableName, Number(customDays))
  }
  // Case 3: A relative date range. E.g. 'lastQuarter'. The actual dates are calculated in Python on runtime.
  else if (isValidRelativeDateInterval(block.metadata.deepnote_variable_value)) {
    const range = DATE_RANGE_INPUT_RELATIVE_RANGES.find(range => range.value === block.metadata.deepnote_variable_value)
    if (!range) {
      throw new InvalidValueError(
        `Invalid relative date interval: "${block.metadata.deepnote_variable_value}". Expected one of: ${DATE_RANGE_INPUT_RELATIVE_RANGES.map(r => r.value).join(', ')}.`,
        { value: block.metadata.deepnote_variable_value }
      )
    }
    return dedent`
      ${range.pythonCode(sanitizedPythonVariableName)}`
  } else {
    return dedent`
      ${sanitizedPythonVariableName} = [None, None]
    `
  }
}

// Type guard functions
export function isInputTextBlock(block: DeepnoteBlock): block is InputTextBlock {
  return block.type === 'input-text'
}

export function isInputTextareaBlock(block: DeepnoteBlock): block is InputTextareaBlock {
  return block.type === 'input-textarea'
}

export function isInputCheckboxBlock(block: DeepnoteBlock): block is InputCheckboxBlock {
  return block.type === 'input-checkbox'
}

export function isInputSelectBlock(block: DeepnoteBlock): block is InputSelectBlock {
  return block.type === 'input-select'
}

export function isInputSliderBlock(block: DeepnoteBlock): block is InputSliderBlock {
  return block.type === 'input-slider'
}

export function isInputFileBlock(block: DeepnoteBlock): block is InputFileBlock {
  return block.type === 'input-file'
}

export function isInputDateBlock(block: DeepnoteBlock): block is InputDateBlock {
  return block.type === 'input-date'
}

export function isInputDateRangeBlock(block: DeepnoteBlock): block is InputDateRangeBlock {
  return block.type === 'input-date-range'
}

export function isInputBlock(block: DeepnoteBlock): block is InputBlock {
  return (
    isInputTextBlock(block) ||
    isInputTextareaBlock(block) ||
    isInputCheckboxBlock(block) ||
    isInputSelectBlock(block) ||
    isInputSliderBlock(block) ||
    isInputFileBlock(block) ||
    isInputDateBlock(block) ||
    isInputDateRangeBlock(block)
  )
}

/**
 * Normalize a raw input value (from a CLI `--input` flag, an HTTP payload, or a user
 * edit) into the shape the block's schema requires for `deepnote_variable_value`, based
 * on the block's type.
 *
 * This is **schema normalization**, not runtime execution logic: it exists so an
 * overridden value round-trips through `deepnoteFileSchema` / `deepnoteSnapshotSchema`
 * — most importantly, a slider value must serialize as a string, not a number, or the
 * snapshot schema rejects it. It does NOT validate a value against a select's allowed
 * options, a slider's range, or a date's format; those remain the caller's concern.
 *
 * Non-input blocks (and any input type not covered) return the value unchanged.
 *
 * @throws {InvalidValueError} for a checkbox value that is not an unambiguous boolean,
 *   or a date-range array that is not exactly `[start, end]`.
 */
export function coerceInputVariableValue(block: DeepnoteBlock, value: unknown): unknown {
  if (isInputCheckboxBlock(block)) {
    return coerceCheckboxValue(value)
  }

  if (isInputSelectBlock(block)) {
    const allowMultiple = block.metadata.deepnote_allow_multiple_values === true
    if (allowMultiple) {
      if (Array.isArray(value)) return value.map(coerceToInputString)
      if (value === null || value === undefined || value === '') return []
      return [coerceToInputString(value)]
    }
    if (Array.isArray(value)) return value.length > 0 ? coerceToInputString(value[0]) : ''
    return coerceToInputString(value)
  }

  if (isInputDateRangeBlock(block)) {
    if (Array.isArray(value)) {
      if (value.length !== 2) {
        throw new InvalidValueError(
          `Invalid date-range value: expected exactly two elements [start, end], received ${value.length}.`,
          { value }
        )
      }
      return [coerceToInputString(value[0]), coerceToInputString(value[1])] as [string, string]
    }
    return coerceToInputString(value)
  }

  if (
    isInputSliderBlock(block) ||
    isInputTextBlock(block) ||
    isInputTextareaBlock(block) ||
    isInputDateBlock(block) ||
    isInputFileBlock(block)
  ) {
    return coerceToInputString(value)
  }

  return value
}

/** Coerce a scalar to the string form input schemas expect; nullish becomes `''`. */
function coerceToInputString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Coerce a value to a checkbox boolean, accepting only unambiguous inputs:
 * `true`/`false`, `1`/`0`, and `"true"`/`"false"` (case-insensitive). Anything else
 * throws rather than silently defaulting (avoids `Boolean('false') === true`).
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
