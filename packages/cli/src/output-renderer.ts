import type { IOutput } from '@deepnote/runtime-core'
import chalk from 'chalk'

/**
 * Render a Jupyter output to the terminal.
 */
export function renderOutput(output: IOutput): void {
  switch (output.output_type) {
    case 'stream':
      renderStreamOutput(output as { output_type: 'stream'; name: string; text: string })
      break

    case 'execute_result':
    case 'display_data':
      renderDataOutput(output as { output_type: string; data: Record<string, unknown> })
      break

    case 'error':
      renderErrorOutput(output as { output_type: 'error'; ename: string; evalue: string; traceback: string[] })
      break
  }
}

function renderStreamOutput(output: { name: string; text: string }): void {
  const text = Array.isArray(output.text) ? output.text.join('') : output.text

  if (output.name === 'stderr') {
    process.stderr.write(chalk.yellow(text))
  } else {
    process.stdout.write(text)
  }
}

function renderDataOutput(output: { data: Record<string, unknown> }): void {
  const data = output.data

  // Prefer text/plain for terminal rendering
  if (data['text/plain']) {
    const text = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : (data['text/plain'] as string)
    console.log(text)
    return
  }

  // Indicate non-renderable outputs
  if (data['text/html']) {
    console.log(chalk.dim('[HTML output - not rendered in terminal]'))
    return
  }

  if (data['image/png'] || data['image/jpeg'] || data['image/svg+xml']) {
    console.log(chalk.dim('[Image output - not rendered in terminal]'))
    return
  }

  // Fallback: show available MIME types
  const mimeTypes = Object.keys(data)
  if (mimeTypes.length > 0) {
    console.log(chalk.dim(`[Output with MIME types: ${mimeTypes.join(', ')}]`))
  }
}

function renderErrorOutput(output: { ename: string; evalue: string; traceback: string[] }): void {
  console.error(chalk.red(`${output.ename}: ${output.evalue}`))

  if (output.traceback && output.traceback.length > 0) {
    for (const line of output.traceback) {
      // Strip ANSI codes that might be in the traceback and apply our own styling
      const cleanLine = stripAnsi(line)
      console.error(chalk.red(cleanLine))
    }
  }
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes require control characters
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
