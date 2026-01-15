import fs from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { decodeUtf8NoBom, deserializeDeepnoteFile } from '@deepnote/blocks'
import chalk from 'chalk'
import type { Command } from 'commander'

export function createInspectAction(program: Command): (path: string | undefined) => Promise<void> {
  return async path => {
    try {
      await inspectDeepnoteFile(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      program.error(message)
    }
  }
}

async function inspectDeepnoteFile(path: string | undefined): Promise<void> {
  if (!path) {
    throw new Error('Missing path to a .deepnote file.')
  }

  const absolutePath = resolve(process.cwd(), path)
  const stat = await fs.stat(absolutePath).catch(() => null)

  if (!stat) {
    throw new Error(`File not found: ${absolutePath}`)
  }

  if (!stat.isFile()) {
    throw new Error(`Path must point to a file: ${absolutePath}`)
  }

  if (extname(absolutePath).toLowerCase() !== '.deepnote') {
    throw new Error('Unsupported file type. Expected a .deepnote file.')
  }

  const rawBytes = await fs.readFile(absolutePath)
  const yamlContent = decodeUtf8NoBom(rawBytes)
  const deepnoteFile = deserializeDeepnoteFile(yamlContent)

  printDeepnoteFileMetadata(absolutePath, deepnoteFile)
}

function printDeepnoteFileMetadata(
  absolutePath: string,
  deepnoteFile: ReturnType<typeof deserializeDeepnoteFile>
): void {
  const { project, metadata, version: fileVersion } = deepnoteFile
  const notebooks = project.notebooks
  const totalBlocks = notebooks.reduce((sum, notebook) => sum + notebook.blocks.length, 0)

  console.log(`${chalk.dim('Path:')} ${absolutePath}`)
  console.log(`${chalk.dim('Name:')} ${project.name}`)
  console.log(`${chalk.dim('Project ID:')} ${project.id}`)
  console.log(`${chalk.dim('Version:')} ${fileVersion}`)
  console.log(`${chalk.dim('Created:')} ${metadata.createdAt}`)

  if (metadata.modifiedAt) {
    console.log(`${chalk.dim('Modified:')} ${metadata.modifiedAt}`)
  }

  if (metadata.exportedAt) {
    console.log(`${chalk.dim('Exported:')} ${metadata.exportedAt}`)
  }

  console.log(`${chalk.dim('Notebooks count:')} ${notebooks.length}`)
  console.log(`${chalk.dim('Blocks:')} ${totalBlocks}`)

  console.log(`${chalk.dim('Notebooks:')}`)
  if (notebooks.length > 0) {
    for (const notebook of notebooks) {
      const moduleSuffix = notebook.isModule ? ', module' : ''
      console.log(`- ${notebook.name} (${notebook.blocks.length} blocks${moduleSuffix})`)
    }
  }
}
