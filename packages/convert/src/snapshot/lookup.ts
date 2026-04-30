import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { DeepnoteSnapshot } from '@deepnote/blocks'
import { deepnoteSnapshotSchema } from '@deepnote/blocks'
import { parse } from 'yaml'
import type { SnapshotInfo, SnapshotOptions } from './types'

/** Default directory name for snapshots */
const DEFAULT_SNAPSHOT_DIR = 'snapshots'

/**
 * Notebook id: UUID (with hyphens), 32-char hex id, or any non-empty id of letters, digits,
 * hyphens, and underscores (e.g. `notebook-1`), matching what snapshot writers embed today.
 */
const SNAPSHOT_NOTEBOOK_ID_PATTERN = '([0-9a-f]{32}|[0-9a-f-]{36}|[a-zA-Z0-9][a-zA-Z0-9_-]*)'

/** Regex pattern for snapshot filenames (new format with notebookId) */
const SNAPSHOT_FILENAME_PATTERN_WITH_NOTEBOOK = new RegExp(
  `^(.+)_([0-9a-f-]{36})_${SNAPSHOT_NOTEBOOK_ID_PATTERN}_(latest|[\\dT:-]+)\\.snapshot\\.deepnote$`
)

/** Regex pattern for snapshot filenames (legacy format without notebookId) */
const SNAPSHOT_FILENAME_PATTERN = /^(.+)_([0-9a-f-]{36})_(latest|[\dT:-]+)\.snapshot\.deepnote$/

/**
 * Parses a snapshot filename into its components.
 *
 * @param filename - The snapshot filename to parse
 * @returns Parsed components or null if filename doesn't match pattern
 */
export function parseSnapshotFilename(
  filename: string
): { slug: string; projectId: string; notebookId?: string; timestamp: string } | null {
  // Try new pattern first (with notebookId)
  const matchNew = SNAPSHOT_FILENAME_PATTERN_WITH_NOTEBOOK.exec(filename)
  if (matchNew) {
    return {
      slug: matchNew[1],
      projectId: matchNew[2],
      notebookId: matchNew[3],
      timestamp: matchNew[4],
    }
  }
  // Fall back to old pattern (without notebookId)
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
        // When notebookId filter is set:
        // - skip new-format snapshots that don't match the notebook
        // - accept old-format snapshots (no notebookId) as fallback
        if (options.notebookId && parsed.notebookId && parsed.notebookId !== options.notebookId) {
          continue
        }
        snapshots.push({
          path: join(snapshotsPath, entry.name),
          slug: parsed.slug,
          projectId: parsed.projectId,
          notebookId: parsed.notebookId,
          timestamp: parsed.timestamp,
        })
      }
    }

    const filterNotebookId = options.notebookId

    // Sort: when filtering by notebook, matching snapshots before legacy fallbacks;
    // then 'latest' first; then by timestamp descending (stable tie-break for equal timestamps)
    snapshots.sort((a, b) => {
      if (filterNotebookId) {
        const aMatches = a.notebookId === filterNotebookId
        const bMatches = b.notebookId === filterNotebookId
        if (aMatches !== bMatches) {
          return aMatches ? -1 : 1
        }
      }

      const aLatest = a.timestamp === 'latest'
      const bLatest = b.timestamp === 'latest'
      if (aLatest !== bLatest) {
        return aLatest ? -1 : 1
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
