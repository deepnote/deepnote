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
    // Escape for Python string literal
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\0/g, '\\x00')
      // Escape other control characters (code points < 0x20 except already handled, and DEL 0x7F)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escaping control chars
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
    return `'${escaped}'`
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
