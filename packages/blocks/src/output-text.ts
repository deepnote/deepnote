export interface ExtractOutputTextOptions {
  /** Include traceback lines (with ANSI escapes stripped) for error outputs. */
  includeTraceback?: boolean
}

/**
 * Extract a human-readable text string from a single Jupyter-style output object.
 * Returns null if the output type is unrecognized or has no textual representation.
 */
export function extractOutputText(output: unknown, options?: ExtractOutputTextOptions): string | null {
  const out = output as Record<string, unknown>

  if (out.output_type === 'stream' && typeof out.text === 'string') {
    return out.text
  }

  if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
    const data = out.data as Record<string, unknown> | undefined
    if (data?.['text/plain']) return String(data['text/plain'])
    if (data?.['text/html']) return '[HTML output]'
    if (data?.['image/png'] || data?.['image/jpeg']) return '[Image output]'
  }

  if (out.output_type === 'error') {
    const ename = String(out.ename || 'Error')
    const evalue = String(out.evalue || '')
    let text = `Error: ${ename}: ${evalue}`
    if (options?.includeTraceback && Array.isArray(out.traceback)) {
      text +=
        '\n' +
        (out.traceback as string[])
          // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences from traceback
          .map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n')
    }
    return text
  }

  return null
}

/**
 * Extract human-readable text from an array of Jupyter-style output objects.
 * Joins non-null results with newlines.
 */
export function extractOutputsText(outputs: unknown[], options?: ExtractOutputTextOptions): string {
  const texts: string[] = []
  for (const output of outputs) {
    const text = extractOutputText(output, options)
    if (text != null) texts.push(text)
  }
  return texts.join('\n')
}
