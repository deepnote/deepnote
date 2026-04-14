import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { deserializeDeepnoteFile, serializeDeepnoteFile, serializeDeepnoteSnapshot } from '@deepnote/blocks'
import {
  findSnapshotsForProject,
  generateSnapshotFilename,
  loadSnapshotFile,
  slugifyProjectName,
  splitByNotebooks,
  splitSnapshotByNotebooks,
} from '@deepnote/convert'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output } from '../output'
import { FileResolutionError, isErrnoException, resolvePathToDeepnoteFile } from '../utils/file-resolver'

export interface SplitOptions {
  output?: string
  force?: boolean
}

/**
 * Creates the split action - splits a multi-notebook .deepnote file into separate files.
 */
export function createSplitAction(_program: Command): (path: string, options: SplitOptions) => Promise<void> {
  return async (inputPath, options) => {
    try {
      const { absolutePath } = await resolvePathToDeepnoteFile(inputPath)
      debug(`Splitting: ${absolutePath}`)

      const content = await fs.readFile(absolutePath, 'utf-8')
      const file = deserializeDeepnoteFile(content)

      if (file.project.notebooks.length <= 1) {
        const c = getChalk()
        output(c.yellow('File contains only one notebook — nothing to split.'))
        return
      }

      const sourceDir = dirname(absolutePath)
      const sourceStem = basename(absolutePath, '.deepnote')
      const outputDir = options.output ? resolve(options.output) : sourceDir

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true })

      // Split into separate files (unique outputFilename per entry)
      const splits = splitByNotebooks(file, sourceStem)

      // Write split files
      const c = getChalk()
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

      // Handle existing snapshots
      const notebookIds = splits.map(s => s.notebook.id)
      const existingSnapshots = await findSnapshotsForProject(sourceDir, file.project.id)

      if (existingSnapshots.length > 0) {
        const snapshotDir = join(outputDir, 'snapshots')
        await fs.mkdir(snapshotDir, { recursive: true })

        for (const snapInfo of existingSnapshots) {
          try {
            const snapshot = await loadSnapshotFile(snapInfo.path)
            const splitSnapshots = splitSnapshotByNotebooks(snapshot, notebookIds)

            for (const { notebook } of splits) {
              const nbSnapshot = splitSnapshots.get(notebook.id)
              if (!nbSnapshot) continue

              const slug = slugifyProjectName(file.project.name) || 'project'
              const snapshotFilename = generateSnapshotFilename({
                slug,
                projectId: file.project.id,
                notebookId: notebook.id,
                timestamp: snapInfo.timestamp,
              })
              const snapshotPath = join(snapshotDir, snapshotFilename)
              await fs.writeFile(snapshotPath, serializeDeepnoteSnapshot(nbSnapshot), 'utf-8')
            }
          } catch (err) {
            debug(`Failed to split snapshot ${snapInfo.path}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        output(`\n  ${c.dim(`Split ${existingSnapshots.length} snapshot(s) into ${snapshotDir}`)}`)
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
