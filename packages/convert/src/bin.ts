#!/usr/bin/env node
import { cli, command } from 'cleye'
import { convert, validate } from './cli.js'

async function main() {
  cli({
    name: 'deepnote-convert',
    version: '1.2.0',
    commands: [
      command(
        {
          name: 'convert',
          alias: 'c',
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
        },
        async argv => {
          await convert({
            inputPath: argv._.path,
            projectName: argv.flags.projectName,
            outputPath: argv.flags.outputPath,
            cwd: argv.flags.cwd ?? process.cwd(),
          })
        }
      ),
      command(
        {
          name: 'validate',
          alias: 'v',
          parameters: ['<path>'],
          flags: {
            cwd: {
              description: 'The working directory to resolve paths relative to.',
              type: String,
            },
          },
        },
        async argv => {
          await validate({
            inputPath: argv._.path,
            cwd: argv.flags.cwd ?? process.cwd(),
          })
        }
      ),
    ],
  })
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  main().catch(error => {
    // biome-ignore lint/suspicious/noConsole: CLI error reporting to stderr is appropriate
    console.error(error)
    process.exit(1)
  })
}
