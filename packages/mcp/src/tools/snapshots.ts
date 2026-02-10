import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import {
  findSnapshotsForProject,
  loadLatestSnapshot,
  loadSnapshotFile,
  mergeSnapshotIntoSource,
  splitDeepnoteFile,
} from '@deepnote/convert'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { stringify as serializeYaml } from 'yaml'

function snapshotError(message: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  }
}

function parseRequiredStringArg(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  return value
}

function parseOptionalStringArg(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  return value
}

export const snapshotTools: Tool[] = [
  {
    name: 'deepnote_snapshot_list',
    title: 'List Snapshots',
    description: `List available snapshots for a Deepnote project.

Snapshots store execution outputs separately from source files, enabling:
- Clean version control (source without outputs)
- Output history and recovery
- Sharing reproducible results

Returns all snapshots found in the specified directory.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to find snapshots for',
        },
        snapshotDir: {
          type: 'string',
          description: 'Directory to search for snapshots (default: "snapshots" in same directory as source)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_snapshot_load',
    title: 'Load Snapshot',
    description: `Load a specific snapshot file or the latest snapshot for a project.

A snapshot contains execution outputs (results, charts, tables) that were
generated when running the notebook. Use this to inspect past outputs.

**Tip:** Snapshots are valid .deepnote files and can be run directly with deepnote_run.
This is useful for debugging - re-run a snapshot to reproduce previous results.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to .deepnote file (to find latest) OR path to specific .snapshot.deepnote file',
        },
        snapshotDir: {
          type: 'string',
          description: 'Directory containing snapshots (default: "snapshots" in same directory)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_snapshot_split',
    title: 'Split into Snapshot',
    description: `Split a .deepnote file into source (no outputs) and snapshot (outputs only).

This is useful for:
- Version control: Keep source clean, outputs separate
- Sharing: Share source without large outputs
- Backup: Preserve outputs before clearing

The source file is updated in place, snapshot is saved to snapshotDir.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to split',
        },
        snapshotDir: {
          type: 'string',
          description: 'Directory to save snapshot (default: "snapshots" in same directory)',
        },
        keepLatest: {
          type: 'boolean',
          description: 'Also create/update a "latest" symlink-style snapshot (default: true)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_snapshot_merge',
    title: 'Merge Snapshot',
    description: `Merge outputs from a snapshot back into a source file.

Use this to restore outputs that were previously split out, or to
apply outputs from one run to a clean source file.

Options:
- skipMismatched: Skip blocks where content hash doesn't match (code changed)`,
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Path to the source .deepnote file (without outputs)',
        },
        snapshotPath: {
          type: 'string',
          description: 'Path to the .snapshot.deepnote file (or "latest" to auto-find)',
        },
        outputPath: {
          type: 'string',
          description: 'Path to save merged result (default: overwrites source)',
        },
        skipMismatched: {
          type: 'boolean',
          description: 'Skip blocks where code has changed since snapshot (default: false)',
        },
      },
      required: ['sourcePath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]

async function handleSnapshotList(args: Record<string, unknown>) {
  const filePath = parseRequiredStringArg(args.path)
  if (!filePath) {
    return snapshotError('path is required')
  }
  if (args.snapshotDir !== undefined && parseOptionalStringArg(args.snapshotDir) === undefined) {
    return snapshotError('snapshotDir must be a non-empty string when provided')
  }
  const snapshotDir = parseOptionalStringArg(args.snapshotDir)

  try {
    const absolutePath = path.resolve(filePath)
    const projectDir = path.dirname(absolutePath)

    // Read file to get the project ID
    const content = await fs.readFile(absolutePath, 'utf-8')
    const file = deserializeDeepnoteFile(content)
    const projectId = file.project.id

    const snapshotOptions = snapshotDir ? { snapshotDir } : {}
    const snapshots = await findSnapshotsForProject(projectDir, projectId, snapshotOptions)
    const resolvedSnapshotDir = snapshotDir ? snapshotDir : path.join(projectDir, 'snapshots')

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              sourcePath: absolutePath,
              snapshotDir: resolvedSnapshotDir,
              snapshotsFound: snapshots.length,
              snapshots: snapshots.map(s => ({
                path: s.path,
                slug: s.slug,
                projectId: s.projectId,
                timestamp: s.timestamp,
                isLatest: s.timestamp === 'latest',
              })),
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    }
  }
}

async function handleSnapshotLoad(args: Record<string, unknown>) {
  const filePath = parseRequiredStringArg(args.path)
  if (!filePath) {
    return snapshotError('path is required')
  }
  if (args.snapshotDir !== undefined && parseOptionalStringArg(args.snapshotDir) === undefined) {
    return snapshotError('snapshotDir must be a non-empty string when provided')
  }
  const snapshotDir = parseOptionalStringArg(args.snapshotDir)

  try {
    const absolutePath = path.resolve(filePath)

    // Check if it's a snapshot file directly
    if (filePath.endsWith('.snapshot.deepnote')) {
      const snapshot = await loadSnapshotFile(absolutePath)

      // Count outputs
      let totalOutputs = 0
      for (const notebook of snapshot.project.notebooks) {
        for (const block of notebook.blocks) {
          const execBlock = block as { outputs?: unknown[] }
          if (execBlock.outputs && execBlock.outputs.length > 0) {
            totalOutputs++
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                path: absolutePath,
                projectName: snapshot.project.name,
                projectId: snapshot.project.id,
                version: snapshot.version,
                notebooks: snapshot.project.notebooks.length,
                blocksWithOutputs: totalOutputs,
                execution: snapshot.execution,
                environment: snapshot.environment,
              },
              null,
              2
            ),
          },
        ],
      }
    }

    // Otherwise, find and load latest snapshot for the source file
    const content = await fs.readFile(absolutePath, 'utf-8')
    const file = deserializeDeepnoteFile(content)
    const projectId = file.project.id
    const snapshotOptions = snapshotDir ? { snapshotDir } : {}
    const snapshot = await loadLatestSnapshot(absolutePath, projectId, snapshotOptions)

    if (!snapshot) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'No snapshot found',
              sourcePath: absolutePath,
              snapshotDir: snapshotDir ? snapshotDir : path.join(path.dirname(absolutePath), 'snapshots'),
              hint: 'Use deepnote_snapshot_split to create a snapshot first',
            }),
          },
        ],
      }
    }

    // Count outputs
    let totalOutputs = 0
    for (const notebook of snapshot.project.notebooks) {
      for (const block of notebook.blocks) {
        const execBlock = block as { outputs?: unknown[] }
        if (execBlock.outputs && execBlock.outputs.length > 0) {
          totalOutputs++
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              sourcePath: absolutePath,
              projectName: snapshot.project.name,
              projectId: snapshot.project.id,
              version: snapshot.version,
              notebooks: snapshot.project.notebooks.length,
              blocksWithOutputs: totalOutputs,
              execution: snapshot.execution,
              environment: snapshot.environment,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    }
  }
}

async function handleSnapshotSplit(args: Record<string, unknown>) {
  const filePath = parseRequiredStringArg(args.path)
  if (!filePath) {
    return snapshotError('path is required')
  }
  if (args.snapshotDir !== undefined && parseOptionalStringArg(args.snapshotDir) === undefined) {
    return snapshotError('snapshotDir must be a non-empty string when provided')
  }
  const snapshotDir = parseOptionalStringArg(args.snapshotDir)
  const keepLatestRaw = args.keepLatest
  let keepLatest: boolean
  if (keepLatestRaw === undefined) {
    keepLatest = true
  } else if (typeof keepLatestRaw === 'string') {
    keepLatest = keepLatestRaw.toLowerCase() === 'true'
  } else {
    keepLatest = Boolean(keepLatestRaw)
  }

  try {
    const absolutePath = path.resolve(filePath)
    const content = await fs.readFile(absolutePath, 'utf-8')
    const file = deserializeDeepnoteFile(content)

    // Split into source and snapshot
    const { source, snapshot } = splitDeepnoteFile(file)

    // Determine snapshot directory and filename
    const defaultSnapshotDir = snapshotDir ? snapshotDir : path.join(path.dirname(absolutePath), 'snapshots')
    await fs.mkdir(defaultSnapshotDir, { recursive: true })

    // Generate timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const slug = file.project.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const snapshotFilename = `${slug}_${file.project.id}_${timestamp}.snapshot.deepnote`
    const snapshotPath = path.join(defaultSnapshotDir, snapshotFilename)

    // Count outputs being extracted
    let outputCount = 0
    for (const notebook of snapshot.project.notebooks) {
      for (const block of notebook.blocks) {
        const execBlock = block as { outputs?: unknown[] }
        if (execBlock.outputs && execBlock.outputs.length > 0) {
          outputCount++
        }
      }
    }

    // Save snapshot
    const snapshotContent = serializeYaml(snapshot)
    await fs.writeFile(snapshotPath, snapshotContent, 'utf-8')

    // Update latest snapshot
    let latestPath: string | undefined
    if (keepLatest) {
      const latestFilename = `${slug}_${file.project.id}_latest.snapshot.deepnote`
      latestPath = path.join(defaultSnapshotDir, latestFilename)
      await fs.writeFile(latestPath, snapshotContent, 'utf-8')
    }

    // Update source file (without outputs)
    const sourceContent = serializeYaml(source)
    await fs.writeFile(absolutePath, sourceContent, 'utf-8')

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              sourcePath: absolutePath,
              snapshotPath,
              latestPath,
              outputsExtracted: outputCount,
              hint: 'Source file updated without outputs. Use deepnote_snapshot_merge to restore.',
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    }
  }
}

async function handleSnapshotMerge(args: Record<string, unknown>) {
  const sourcePath = parseRequiredStringArg(args.sourcePath)
  if (!sourcePath) {
    return snapshotError('sourcePath is required')
  }
  if (args.snapshotPath !== undefined && parseOptionalStringArg(args.snapshotPath) === undefined) {
    return snapshotError('snapshotPath must be a non-empty string when provided')
  }
  if (args.outputPath !== undefined && parseOptionalStringArg(args.outputPath) === undefined) {
    return snapshotError('outputPath must be a non-empty string when provided')
  }
  const snapshotPath = parseOptionalStringArg(args.snapshotPath)
  const outputPath = parseOptionalStringArg(args.outputPath)
  const skipMismatchedRaw = args.skipMismatched
  let skipMismatched: boolean
  if (typeof skipMismatchedRaw === 'boolean') {
    skipMismatched = skipMismatchedRaw
  } else if (skipMismatchedRaw == null) {
    skipMismatched = false
  } else {
    skipMismatched = String(skipMismatchedRaw).toLowerCase() === 'true'
  }

  try {
    const absoluteSourcePath = path.resolve(sourcePath)
    const sourceContent = await fs.readFile(absoluteSourcePath, 'utf-8')
    const source = deserializeDeepnoteFile(sourceContent)

    // Load snapshot - either from path or find latest
    let snapshot: DeepnoteSnapshot | null = null
    if (snapshotPath && snapshotPath !== 'latest') {
      const absoluteSnapshotPath = path.resolve(snapshotPath)
      snapshot = await loadSnapshotFile(absoluteSnapshotPath)
    } else {
      snapshot = await loadLatestSnapshot(absoluteSourcePath, source.project.id)

      if (!snapshot) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'No snapshot found',
                sourcePath: absoluteSourcePath,
                hint: 'Provide snapshotPath or run deepnote_snapshot_split first',
              }),
            },
          ],
        }
      }
    }

    // Merge outputs into source
    const merged = mergeSnapshotIntoSource(source, snapshot, { skipMismatched })

    // Count merged outputs
    let outputCount = 0
    for (const notebook of merged.project.notebooks) {
      for (const block of notebook.blocks) {
        const execBlock = block as { outputs?: unknown[] }
        if (execBlock.outputs && execBlock.outputs.length > 0) {
          outputCount++
        }
      }
    }

    // Save result
    const finalPath = outputPath ? path.resolve(outputPath) : absoluteSourcePath
    const mergedContent = serializeYaml(merged)
    await fs.writeFile(finalPath, mergedContent, 'utf-8')

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              outputPath: finalPath,
              blocksWithOutputs: outputCount,
              skipMismatched,
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    }
  }
}

export async function handleSnapshotTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_snapshot_list':
      return handleSnapshotList(safeArgs)
    case 'deepnote_snapshot_load':
      return handleSnapshotLoad(safeArgs)
    case 'deepnote_snapshot_split':
      return handleSnapshotSplit(safeArgs)
    case 'deepnote_snapshot_merge':
      return handleSnapshotMerge(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown snapshot tool: ${name}` }],
        isError: true,
      }
  }
}
