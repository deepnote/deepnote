#!/usr/bin/env node
import { cli } from 'cleye'
import { convert } from './cli.js'
import {
  isSourceNotebookFormat,
  SOURCE_NOTEBOOK_FORMATS,
  type SourceNotebookFormat,
} from './source-notebook-formats.js'

/** cleye flag parser: validates `--outputFormat` against the shared source-notebook format set (from .deepnote). */
function OutputFormat(value: string): SourceNotebookFormat {
  if (!isSourceNotebookFormat(value)) {
    throw new Error(`Invalid --outputFormat "${value}". Expected one of: ${SOURCE_NOTEBOOK_FORMATS.join(', ')}.`)
  }
  return value
}

async function main() {
  const argv = cli({
    name: 'deepnote-convert',
    parameters: ['<path>'],
    flags: {
      projectName: {
        description: 'The name of the Deepnote project.',
        type: String,
      },
      outputPath: {
        alias: 'o',
        description: 'The path where the .deepnote file will be saved.',
        type: String,
      },
      outputFormat: {
        description: 'Output format when converting from .deepnote: jupyter (default), percent, quarto, or marimo.',
        type: OutputFormat,
      },
      cwd: {
        description: 'The working directory to resolve paths relative to.',
        type: String,
      },
      singleFile: {
        description: 'Output a single file with outputs included (disables snapshot mode).',
        type: Boolean,
        default: false,
      },
    },
  })

  await convert({
    inputPath: argv._.path,
    projectName: argv.flags.projectName,
    outputPath: argv.flags.outputPath,
    outputFormat: argv.flags.outputFormat,
    cwd: argv.flags.cwd ?? process.cwd(),
    singleFile: argv.flags.singleFile,
  })
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  main().catch(error => {
    // biome-ignore lint/suspicious/noConsole: CLI error reporting to stderr is appropriate
    console.error(error)
    process.exit(1)
  })
}
