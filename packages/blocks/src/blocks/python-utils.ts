export function escapePythonString(value: string): string {
  // No control character may reach the generated source raw. IPython breaks cell source into lines on VT, FF,
  // FS, GS, RS, NEL, LS and PS as well as LF and CR, then strips prompt-like prefixes (">>> ", "In [1]: ")
  // from each line, which corrupts a value that contains them.
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escaping control characters
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/g, char => {
      const code = char.charCodeAt(0)
      return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`
    })

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
