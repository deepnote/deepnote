import { basename, dirname, resolve } from 'node:path'
import type { SnapshotOptions } from './types'

/** Default directory name for snapshots */
const DEFAULT_SNAPSHOT_DIR = 'snapshots'

/** Regex pattern for snapshot filenames */
const SNAPSHOT_FILENAME_PATTERN = /^(.+)_([0-9a-f-]{36})_(latest|[\dT:-]+)\.snapshot\.deepnote$/

/**
 * Parses a snapshot filename into its components.
 *
 * @param filename - The snapshot filename to parse
 * @returns Parsed components or null if filename doesn't match pattern
 *
 * @deprecated Use `@deepnote/runtime-core` for snapshot file operations.
 * This function is kept for backwards compatibility.
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
 * Gets the snapshot directory path for a source file.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @param options - Snapshot options
 * @returns The snapshot directory path
 *
 * @deprecated Use `@deepnote/runtime-core` for snapshot file operations.
 * This function is kept for backwards compatibility.
 */
export function getSnapshotDir(sourceFilePath: string, options: SnapshotOptions = {}): string {
  const snapshotDir = options.snapshotDir ?? DEFAULT_SNAPSHOT_DIR
  return resolve(dirname(sourceFilePath), snapshotDir)
}

/**
 * Extracts project information from a source file path.
 *
 * @param sourceFilePath - Path to the source .deepnote file
 * @returns Object with directory and filename without extension
 *
 * @deprecated Use `@deepnote/runtime-core` for snapshot file operations.
 * This function is kept for backwards compatibility.
 */
export function parseSourceFilePath(sourceFilePath: string): { dir: string; name: string } {
  const dir = dirname(sourceFilePath)
  const filename = basename(sourceFilePath)
  const name = filename.replace(/\.deepnote$/, '')
  return { dir, name }
}

// Note: File I/O functions (findSnapshotsForProject, loadLatestSnapshot, loadSnapshotFile,
// snapshotExists) have been moved to @deepnote/runtime-core.
// Import them from '@deepnote/runtime-core' instead.
