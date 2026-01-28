import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { deepnoteSnapshotSchema } from '@deepnote/blocks'
import { parse } from 'yaml'
import type { SnapshotInfo, SnapshotOptions } from './types'

/** Default directory name for snapshots */
const DEFAULT_SNAPSHOT_DIR = 'snapshots'

/** Regex pattern for snapshot filenames */
const SNAPSHOT_FILENAME_PATTERN = /^(.+)_([0-9a-f-]{36})_(latest|[\dT:-]+)\.snapshot\.deepnote$/

/**
 * Parses a snapshot filename into its components.
 *
 * @param filename - The snapshot filename to parse
 * @returns Parsed components or null if filename doesn't match pattern
 */
export function parseSnapshotFilename(filename: string): { slug: string; projectId: string; timestamp: string } | null {
  const match = SNAPSHOT_FILENAME_PATTERN.exec(filename)
  if (!match) {
    return null
  }
  return {
    slug: match[1],
    projectId: match[2],
    timestamp: match[3],
  }
}

/**
 * Finds all snapshot files for a given project.
 *
 * @param projectDir - Directory containing the .deepnote file
 * @param projectId - The project UUID to search for
 * @param options - Snapshot options
 * @returns Array of SnapshotInfo objects, sorted by timestamp (newest first)
 */
export async function findSnapshotsForProject(
  projectDir: string,
  projectId: string,
  options: SnapshotOptions = {}
): Promise<SnapshotInfo[]> {
  const snapshotDir = options.snapshotDir ?? DEFAULT_SNAPSHOT_DIR
  const snapshotsPath = resolve(projectDir, snapshotDir)

  try {
    const entries = await fs.readdir(snapshotsPath, { withFileTypes: true })
    const snapshots: SnapshotInfo[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.snapshot.deepnote')) {
        continue
      }

      const parsed = parseSnapshotFilename(entry.name)
      if (parsed && parsed.projectId === projectId) {
        snapshots.push({
          path: join(snapshotsPath, entry.name),
          slug: parsed.slug,
          projectId: parsed.projectId,
          timestamp: parsed.timestamp,
        })
      }
    }

    // Sort: 'latest' first, then by timestamp descending
    snapshots.sort((a, b) => {
      if (a.timestamp === 'latest') {
        return -1
      }
      if (b.timestamp === 'latest') {
        return 1
      }
      return b.timestamp.localeCompare(a.timestamp)
    })

    return snapshots
  } catch (err) {
    // Directory doesn't exist or can't be read
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * Loads the latest snapshot for a project.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @param projectId - The project UUID
 * @param options - Snapshot options
 * @returns The parsed DeepnoteSnapshot or null if not found
 */
export async function loadLatestSnapshot(
  sourceFilePath: string,
  projectId: string,
  options: SnapshotOptions = {}
): Promise<DeepnoteSnapshot | null> {
  const projectDir = dirname(sourceFilePath)
  const snapshots = await findSnapshotsForProject(projectDir, projectId, options)

  if (snapshots.length === 0) {
    return null
  }

  // Load the first (most recent) snapshot
  const snapshotInfo = snapshots[0]
  return loadSnapshotFile(snapshotInfo.path)
}

/**
 * Loads and parses a snapshot file.
 *
 * @param snapshotPath - Path to the snapshot file
 * @returns The parsed DeepnoteSnapshot
 */
export async function loadSnapshotFile(snapshotPath: string): Promise<DeepnoteSnapshot> {
  const content = await fs.readFile(snapshotPath, 'utf-8')
  const parsed = parse(content)
  return deepnoteSnapshotSchema.parse(parsed)
}

/**
 * Gets the snapshot directory path for a source file.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @param options - Snapshot options
 * @returns The snapshot directory path
 */
export function getSnapshotDir(sourceFilePath: string, options: SnapshotOptions = {}): string {
  const snapshotDir = options.snapshotDir ?? DEFAULT_SNAPSHOT_DIR
  return resolve(dirname(sourceFilePath), snapshotDir)
}

/**
 * Checks if a snapshot exists for a project.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @param projectId - The project UUID
 * @param options - Snapshot options
 * @returns True if at least one snapshot exists
 */
export async function snapshotExists(
  sourceFilePath: string,
  projectId: string,
  options: SnapshotOptions = {}
): Promise<boolean> {
  const projectDir = dirname(sourceFilePath)
  const snapshots = await findSnapshotsForProject(projectDir, projectId, options)
  return snapshots.length > 0
}

/**
 * Extracts project information from a source file path.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @returns Object with directory and filename without extension
 */
export function parseSourceFilePath(sourceFilePath: string): { dir: string; name: string } {
  const dir = dirname(sourceFilePath)
  const filename = basename(sourceFilePath)
  const name = filename.replace(/\.deepnote$/, '')
  return { dir, name }
}
