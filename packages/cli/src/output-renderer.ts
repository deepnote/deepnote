import { stripVTControlCharacters } from 'node:util'
import type { IDisplayData, IError, IExecuteResult, IOutput, IStream } from '@deepnote/runtime-core'
import { getChalk, error as logError, output } from './output'

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

function renderStreamOutput(streamOutput: IStream): void {
  const text = Array.isArray(streamOutput.text) ? streamOutput.text.join('') : streamOutput.text

  if (streamOutput.name === 'stderr') {
    process.stderr.write(getChalk().yellow(text))
  } else {
    process.stdout.write(text)
  }
}

function renderDataOutput(dataOutput: IDisplayData | IExecuteResult): void {
  const data = dataOutput.data
  const c = getChalk()

  // Prefer text/plain for terminal rendering
  if (data['text/plain']) {
    const text = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : (data['text/plain'] as string)
    output(text)
    return
  }

  // Indicate non-renderable outputs
  if (data['text/html']) {
    output(c.dim('[HTML output - not rendered in terminal]'))
    return
  }

  if (data['image/png'] || data['image/jpeg'] || data['image/svg+xml']) {
    output(c.dim('[Image output - not rendered in terminal]'))
    return
  }

  // Fallback: show available MIME types
  const mimeTypes = Object.keys(data)
  if (mimeTypes.length > 0) {
    output(c.dim(`[Output with MIME types: ${mimeTypes.join(', ')}]`))
  }
}

function renderErrorOutput(errorOutput: IError): void {
  const c = getChalk()
  logError(c.red(`${errorOutput.ename}: ${errorOutput.evalue}`))

  if (errorOutput.traceback && errorOutput.traceback.length > 0) {
    for (const line of errorOutput.traceback) {
      // Strip ANSI codes that might be in the traceback and apply our own styling
      const cleanLine = stripVTControlCharacters(line)
      logError(c.red(cleanLine))
    }
  }
}
