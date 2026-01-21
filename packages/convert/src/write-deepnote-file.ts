import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { stringify } from 'yaml'
import { generateSnapshotFilename, getSnapshotDir, hasOutputs, slugifyProjectName, splitDeepnoteFile } from './snapshot'

export interface WriteDeepnoteFileOptions {
  /** The DeepnoteFile to write */
  file: DeepnoteFile
  /** Path where the main .deepnote file should be written */
  outputPath: string
  /** Project name used for snapshot filename */
  projectName: string
  /** When true, outputs are included in the main file (disables snapshot mode) */
  singleFile?: boolean
}

export interface WriteDeepnoteFileResult {
  /** Path to the written source file */
  sourcePath: string
  /** Path to the snapshot file (only if outputs were split) */
  snapshotPath?: string
}

/**
 * Writes a DeepnoteFile to disk, optionally splitting outputs into a snapshot file.
 *
 * When singleFile is false (default) and the file contains outputs:
 * - Splits the file in memory into source (no outputs) and snapshot (with outputs)
 * - Writes both files in parallel
 *
 * When singleFile is true or there are no outputs:
 * - Writes the complete file as-is
 *
 * @param options - Write options including the file, output path, and project name
 * @returns Object containing paths to the written files
 */
export async function writeDeepnoteFile(options: WriteDeepnoteFileOptions): Promise<WriteDeepnoteFileResult> {
  const { file, outputPath, projectName, singleFile = false } = options

  // Ensure parent directory exists
  const parentDir = dirname(outputPath)
  await fs.mkdir(parentDir, { recursive: true })

  // If singleFile mode or no outputs, write complete file
  if (singleFile || !hasOutputs(file)) {
    const yamlContent = stringify(file)
    await fs.writeFile(outputPath, yamlContent, 'utf-8')
    return { sourcePath: outputPath }
  }

  // Split into source and snapshot in memory
  const { source, snapshot } = splitDeepnoteFile(file)

  // Prepare snapshot path
  const snapshotDir = getSnapshotDir(outputPath)
  const slug = slugifyProjectName(projectName)
  const snapshotFilename = generateSnapshotFilename(slug, file.project.id)
  const snapshotPath = resolve(snapshotDir, snapshotFilename)

  // Serialize both files
  const sourceYaml = stringify(source)
  const snapshotYaml = stringify(snapshot)

  // Create snapshot directory and write both files in parallel
  await fs.mkdir(snapshotDir, { recursive: true })
  await Promise.all([fs.writeFile(outputPath, sourceYaml, 'utf-8'), fs.writeFile(snapshotPath, snapshotYaml, 'utf-8')])

  return { sourcePath: outputPath, snapshotPath }
}
