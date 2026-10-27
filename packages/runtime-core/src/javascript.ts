import { escapePythonString } from '@deepnote/blocks'

/**
 * Convert a JavaScript value to a Python literal.
 */
export function toPythonLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None'
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot convert non-finite number to Python: ${value}`)
    }
    return String(value)
  }
  if (typeof value === 'string') {
    return escapePythonString(value)
  }
  if (Array.isArray(value)) {
    const elements = value.map(v => toPythonLiteral(v))
    return `[${elements.join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${toPythonLiteral(k)}: ${toPythonLiteral(v)}`)
    return `{${entries.join(', ')}}`
  }
  throw new Error(`Cannot convert value of type ${typeof value} to Python literal`)
}
