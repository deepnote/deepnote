import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { deepnoteSnapshotSchema } from '@deepnote/blocks'
import { parse } from 'yaml'
import { resolveSnapshotNotebookId } from './snapshot-notebook-id'
import { decodeNotebookIdFromFilename, generateSnapshotFilename, slugifyProjectName } from './split'
import type { SnapshotInfo, SnapshotOptions } from './types'

/** Options for {@link getSnapshotPath}. */
export interface GetSnapshotPathOptions {
  /** Project name used for the slug; defaults to `file.project.name`. */
  projectName?: string
  /** Filename timestamp segment; defaults to `'latest'`. */
  timestamp?: string
  /** Directory where snapshot files are stored (default: `snapshots` next to the source file). */
  snapshotDir?: string
}

/** Default directory name for snapshots */
const DEFAULT_SNAPSHOT_DIR = 'snapshots'

/** Notebook id as embedded by {@link generateSnapshotFilename}: UUID, 32-char hex, or a reversibly percent-encoded id (`[A-Za-z0-9_-]` kept verbatim, every other char as `%XX`). */
const SNAPSHOT_NOTEBOOK_ID_PATTERN = '([0-9a-f]{32}|[0-9a-f-]{36}|[A-Za-z0-9_%-]+)'

/** Regex pattern for snapshot filenames (new format with notebookId) */
const SNAPSHOT_SINGLE_NOTEBOOK_FILENAME_PATTERN = new RegExp(
  `^(.+)_([0-9a-f-]{36})_${SNAPSHOT_NOTEBOOK_ID_PATTERN}_(latest|[\\dT:-]+)\\.snapshot\\.deepnote$`
)

/** Regex pattern for snapshot filenames (legacy format without notebookId) */
const SNAPSHOT_MULTI_NOTEBOOK_FILENAME_PATTERN = /^(.+)_([0-9a-f-]{36})_(latest|[\dT:-]+)\.snapshot\.deepnote$/

/**
 * Parses a snapshot filename into its components.
 *
 * @param filename - The snapshot filename to parse
 * @returns Parsed components or null if filename doesn't match pattern
 */
export function parseSnapshotFilename(
  filename: string
): { slug: string; projectId: string; notebookId?: string; timestamp: string } | null {
  const match = SNAPSHOT_SINGLE_NOTEBOOK_FILENAME_PATTERN.exec(filename)
  if (match) {
    return {
      slug: match[1],
      projectId: match[2],
      // Decode back to the original id so lookup compares raw-vs-raw (the writer percent-encodes it).
      notebookId: decodeNotebookIdFromFilename(match[3]),
      timestamp: match[4],
    }
  }
  const matchLegacyMultiNotebook = SNAPSHOT_MULTI_NOTEBOOK_FILENAME_PATTERN.exec(filename)
  if (!matchLegacyMultiNotebook) {
    return null
  }
  return {
    slug: matchLegacyMultiNotebook[1],
    projectId: matchLegacyMultiNotebook[2],
    timestamp: matchLegacyMultiNotebook[3],
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
        if (options.notebookId) {
          // Scoped request: skip other notebooks' scoped snapshots, but keep legacy
          // (no-notebookId) ones as a fallback.
          if (parsed.notebookId && parsed.notebookId !== options.notebookId) {
            continue
          }
        } else if (parsed.notebookId) {
          // Unscoped (multi-notebook/legacy) load: never borrow a split sibling's
          // notebook-scoped snapshot, which would load an arbitrary notebook's outputs.
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

    // Sort: notebook matches before legacy fallbacks, then 'latest' first, then timestamp descending.
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
 * Resolves the path where a snapshot file would be stored for a source file.
 *
 * Notebook-scoped filenames are used when {@link resolveSnapshotNotebookId} returns
 * an id (single-notebook files and composed `[init, main]` shapes); otherwise the
 * legacy project-wide filename format is used.
 *
 * @param sourcePath - Path to the source .deepnote file
 * @param file - The DeepnoteFile used to derive project id, slug, and notebook scope
 * @param options - Optional slug source, timestamp segment, and snapshot directory
 * @returns Absolute path to the snapshot file
 */
export function getSnapshotPath(sourcePath: string, file: DeepnoteFile, options: GetSnapshotPathOptions = {}): string {
  const { projectName, timestamp = 'latest', snapshotDir } = options
  const dir = getSnapshotDir(sourcePath, snapshotDir !== undefined ? { snapshotDir } : {})
  const slug = slugifyProjectName(projectName ?? file.project.name) || 'project'
  const notebookId = resolveSnapshotNotebookId(file)
  const filename = generateSnapshotFilename({ slug, projectId: file.project.id, notebookId, timestamp })
  return resolve(dir, filename)
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
