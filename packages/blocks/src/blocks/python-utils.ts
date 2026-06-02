export function escapePythonString(value: string): string {
  // Escape characters that would otherwise terminate or invalidate a single-quoted
  // Python string literal: backslash, single quote, LF, CR, and NUL.
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\x00', '\\x00')

  // Wrap the escaped string in single quotes
  return `'${escaped}'`
}

export function sanitizePythonVariableName(
  name: string,
  options: Partial<{ disableEmptyFallback: boolean }> = {}
): string {
  let sanitizedVariableName = name
    // Convert whitespace to underscores
    .replace(/\s+/g, '_')
    // Remove invalid characters
    .replace(/[^0-9a-zA-Z_]/g, '')
    // Remove invalid leading characters
    .replace(/^[^a-zA-Z_]+/g, '')

  // Set a default value
  if (sanitizedVariableName === '' && !options.disableEmptyFallback) {
    sanitizedVariableName = 'input_1' // We don't want to call it just `input` to avoid name clashes
  }

  return sanitizedVariableName
}
