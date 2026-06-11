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

      // Emit one `[init, main]` snapshot per non-init notebook plus an init-only `[init]` snapshot, matching the run-time model.
      const initNotebookId = file.project.initNotebookId
      const initNotebookInProject =
        initNotebookId === undefined ? undefined : file.project.notebooks.find(nb => nb.id === initNotebookId)
      const initSplitEntry = splits.find(s => s.kind === 'init')
      const mainSplitEntries = splits.filter(s => s.kind === 'notebook')

      const snapshotNotebookIds = Array.from(
        new Set([
          ...(initNotebookInProject ? [initNotebookInProject.id] : []),
          ...mainSplitEntries.map(s => s.notebook.id),
        ])
      )
      const existingSnapshots = await findSnapshotsForProject(sourceDir, file.project.id)

      if (existingSnapshots.length > 0) {
        const snapshotDir = join(outputDir, 'snapshots')
        await fs.mkdir(snapshotDir, { recursive: true })
        const snapshotFailures: { path: string; message: string }[] = []

        for (const snapInfo of existingSnapshots) {
          try {
            const snapshot = await loadSnapshotFile(snapInfo.path)
            const splitSnapshots = splitSnapshotByNotebooks(snapshot, snapshotNotebookIds)

            // Main snapshots keep [init, main] shape so each split file's snapshot is a complete record of what would run.
            for (const mainEntry of mainSplitEntries) {
              const mainSnapshot = splitSnapshots.get(mainEntry.notebook.id)
              if (!mainSnapshot) continue

              let nbSnapshot = mainSnapshot
              if (initNotebookInProject !== undefined) {
                const initSnapshot = splitSnapshots.get(initNotebookInProject.id)
                if (initSnapshot) {
                  const initNb = initSnapshot.project.notebooks[0]
                  const mainNb = mainSnapshot.project.notebooks[0]
                  nbSnapshot = {
                    ...mainSnapshot,
                    project: {
                      ...mainSnapshot.project,
                      notebooks: [initNb, mainNb],
                    },
                  }
                }
              }

              const slug = slugifyProjectName(file.project.name) || 'project'
              const snapshotFilename = generateSnapshotFilename({
                slug,
                projectId: file.project.id,
                notebookId: mainEntry.notebook.id,
                timestamp: snapInfo.timestamp,
              })
              const snapshotPath = join(snapshotDir, snapshotFilename)
              await fs.writeFile(snapshotPath, serializeDeepnoteSnapshot(nbSnapshot), 'utf-8')
            }

            // Init-only [init] snapshot, keyed by init notebook id, for the standalone init file.
            if (initSplitEntry !== undefined && initNotebookInProject !== undefined) {
              const initSnapshot = splitSnapshots.get(initNotebookInProject.id)
              if (initSnapshot) {
                const slug = slugifyProjectName(file.project.name) || 'project'
                const snapshotFilename = generateSnapshotFilename({
                  slug,
                  projectId: file.project.id,
                  notebookId: initNotebookInProject.id,
                  timestamp: snapInfo.timestamp,
                })
                const snapshotPath = join(snapshotDir, snapshotFilename)
                await fs.writeFile(snapshotPath, serializeDeepnoteSnapshot(initSnapshot), 'utf-8')
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            snapshotFailures.push({ path: snapInfo.path, message })
          }
        }

        if (snapshotFailures.length > 0) {
          output(`\n  ${c.yellow('Warning: one or more snapshots could not be split:')}`)
          for (const failure of snapshotFailures) {
            output(`  ${c.yellow('•')} ${failure.path}`)
            output(`    ${c.dim(failure.message)}`)
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
