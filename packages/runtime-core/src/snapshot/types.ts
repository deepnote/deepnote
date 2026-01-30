import type { IOutput } from '@jupyterlab/nbformat'

/**
 * Options for snapshot operations
 */
export interface SnapshotOptions {
  /** Directory where snapshot files are stored (default: 'snapshots') */
  snapshotDir?: string
}

/**
 * Information about a snapshot file
 */
export interface SnapshotInfo {
  /** Full path to the snapshot file */
  path: string
  /** Project name slug */
  slug: string
  /** Project ID */
  projectId: string
  /** Timestamp or 'latest' */
  timestamp: string
}

/**
 * Result of a single block execution (outputs from runtime)
 */
export interface BlockExecutionOutput {
  id: string
  outputs: IOutput[]
  executionCount?: number | null
}

/**
 * Execution timing information
 */
export interface ExecutionTiming {
  startedAt: string
  finishedAt: string
}

/**
 * Result of saving a snapshot
 */
export interface SaveSnapshotResult {
  snapshotPath: string
}
