import { stripVTControlCharacters } from 'node:util'
import type { IDisplayData, IError, IExecuteResult, IOutput, IStream } from '@deepnote/runtime-core'
import chalk from 'chalk'

/**
 * Render a Jupyter output to the terminal.
 */
export function renderOutput(output: IOutput): void {
  if (isStream(output)) {
    renderStreamOutput(output)
  } else if (isDisplayData(output) || isExecuteResult(output)) {
    renderDataOutput(output)
  } else if (isError(output)) {
    renderErrorOutput(output)
  }
}

function isStream(output: IOutput): output is IStream {
  return output.output_type === 'stream'
}

function isDisplayData(output: IOutput): output is IDisplayData {
  return output.output_type === 'display_data'
}

function isExecuteResult(output: IOutput): output is IExecuteResult {
  return output.output_type === 'execute_result'
}

function isError(output: IOutput): output is IError {
  return output.output_type === 'error'
}

function renderStreamOutput(output: IStream): void {
  const text = Array.isArray(output.text) ? output.text.join('') : output.text

  if (output.name === 'stderr') {
    process.stderr.write(chalk.yellow(text))
  } else {
    process.stdout.write(text)
  }
}

function renderDataOutput(output: IDisplayData | IExecuteResult): void {
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

function renderErrorOutput(output: IError): void {
  console.error(chalk.red(`${output.ename}: ${output.evalue}`))

  if (output.traceback && output.traceback.length > 0) {
    for (const line of output.traceback) {
      // Strip ANSI codes that might be in the traceback and apply our own styling
      const cleanLine = stripVTControlCharacters(line)
      console.error(chalk.red(cleanLine))
    }
  }
}
