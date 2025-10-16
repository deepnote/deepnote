#!/usr/bin/env node
import { cli } from 'cleye'
import { convert } from './cli.js'

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
      cwd: {
        description: 'The working directory to resolve paths relative to.',
        type: String,
      },
    },
  })

  await convert({
    inputPath: argv._.path,
    projectName: argv.flags.projectName,
    outputPath: argv.flags.outputPath,
    cwd: argv.flags.cwd ?? process.cwd(),
  })
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  main().catch(error => {
    // biome-ignore lint/suspicious/noConsole: CLI error reporting to stderr is appropriate
    console.error(error)
    process.exit(1)
  })
}
