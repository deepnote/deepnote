#!/usr/bin/env node
import { startMockDeepnoteCloud } from './mock-deepnote-cloud'

startMockDeepnoteCloud({ rootDir: process.argv[2] }).then(
  ({ rootDir, url }) => {
    process.stdout.write(`Serving the Deepnote projects in ${rootDir}\nAPI base URL: ${url}\n`)
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
)
