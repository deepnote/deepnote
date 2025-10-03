export function escapePythonString(value: string): string {
  // We have to escape backslashes, single quotes, and newlines
  const escaped = value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')

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
