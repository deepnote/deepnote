import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { deserializeDeepnoteFile, serializeDeepnoteFile, serializeDeepnoteSnapshot } from '@deepnote/blocks'
import {
  findSnapshotsForProject,
  generateSnapshotFilename,
  generateSplitFilename,
  loadSnapshotFile,
  slugifyProjectName,
  splitByNotebooks,
  splitSnapshotByNotebooks,
} from '@deepnote/convert'
import type { Command } from 'commander'
import { ExitCode } from '../exit-codes'
import { debug, getChalk, error as logError, output } from '../output'
import { FileResolutionError, resolvePathToDeepnoteFile } from '../utils/file-resolver'

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

      // Split into separate files
      const splits = splitByNotebooks(file)

      // Check for existing output files (unless --force)
      if (!options.force) {
        for (const { notebook } of splits) {
          const outName = generateSplitFilename(sourceStem, notebook.name)
          const outPath = join(outputDir, outName)
          try {
            await fs.access(outPath)
            throw new Error(`Output file already exists: ${outPath}. Use --force to overwrite.`)
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw err
            }
          }
        }
      }

      // Write split files
      const c = getChalk()
      const writtenFiles: string[] = []
      for (const { notebook, file: splitFile } of splits) {
        const outName = generateSplitFilename(sourceStem, notebook.name)
        const outPath = join(outputDir, outName)
        const yaml = serializeDeepnoteFile(splitFile)
        await fs.writeFile(outPath, yaml, 'utf-8')
        writtenFiles.push(outPath)
        output(`  ${c.green('✓')} ${outName}`)
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
              const snapshotFilename = generateSnapshotFilename(slug, file.project.id, notebook.id, snapInfo.timestamp)
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
