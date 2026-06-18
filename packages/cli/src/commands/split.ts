import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '@deepnote/blocks'
import { splitByNotebooks } from '@deepnote/convert'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output } from '../output'
import { FileResolutionError, isErrnoException, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface SplitOptions {
  output?: string
  force?: boolean
}

/** Creates the split action - splits a multi-notebook .deepnote file into separate files. */
export function createSplitAction(_program: Command): (path: string, options: SplitOptions) => Promise<void> {
  return async (inputPath, options) => {
    try {
      const { absolutePath } = await resolvePathToDeepnoteFile(inputPath)
      debug(`Splitting: ${absolutePath}`)

      const content = await fs.readFile(absolutePath, 'utf-8')
      const file = deserializeDeepnoteFile(content)

      const sourceDir = dirname(absolutePath)
      const sourceStem = basename(absolutePath, '.deepnote')
      const splits = splitByNotebooks(file, sourceStem)
      const c = getChalk()
      if (splits.length === 0 || (splits.length === 1 && file.project.notebooks.length === 1)) {
        output(c.yellow('File contains only one notebook — nothing to split.'))
        return
      }

      const outputDir = options.output ? resolve(options.output) : sourceDir

      await fs.mkdir(outputDir, { recursive: true })

      // Each split entry is its own single-notebook file (kind 'init' or 'notebook') — see splitByNotebooks docs.
      const writtenFiles: string[] = []
      const force = Boolean(options.force)
      for (const split of splits) {
        const outPath = join(outputDir, split.outputFilename)
        const yaml = serializeDeepnoteFile(split.file)
        try {
          await fs.writeFile(outPath, yaml, { encoding: 'utf-8', flag: force ? 'w' : 'wx' })
        } catch (err) {
          if (!force && isErrnoException(err, 'EEXIST')) {
            throw new Error(`Output file already exists: ${outPath}. Use --force to overwrite.`)
          }
          throw err
        }
        writtenFiles.push(outPath)
        output(`  ${c.green('✓')} ${basename(outPath)}`)
      }

      output(`\n${c.green('✓')} Split into ${writtenFiles.length} files`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const exitCode = error instanceof FileResolutionError ? ExitCode.InvalidUsage : ExitCode.Error
      logError(message)
      process.exit(exitCode)
    }
  }
}
