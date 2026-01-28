import type { DeepnoteFile, DeepnoteSnapshot, Environment, Execution } from '@deepnote/blocks'

/**
 * Options for snapshot operations
 */
export interface SnapshotOptions {
  /** Directory where snapshot files are stored (default: 'snapshots') */
  snapshotDir?: string
}

/**
 * Result of splitting a DeepnoteFile into source and snapshot
 */
export interface SplitResult {
  /** The source file without outputs */
  source: DeepnoteFile
  /** The snapshot file containing outputs */
  snapshot: DeepnoteSnapshot
}

/**
 * Block output information stored in a snapshot
 */
export interface BlockOutput {
  /** Block ID */
  id: string
  /** Content hash of the source when output was generated */
  contentHash?: string
  /** Execution count */
  executionCount?: number | null
  /** When execution started */
  executionStartedAt?: string
  /** When execution finished */
  executionFinishedAt?: string
  /** Output data */
  outputs?: unknown[]
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
 * Options for merging a snapshot into a source file
 */
export interface MergeOptions {
  /** Whether to skip blocks with mismatched content hashes (default: false) */
  skipMismatched?: boolean
}

/**
 * A block with output fields that can be cleared
 */
export interface ExecutableBlockFields {
  executionCount?: number | null
  executionStartedAt?: string
  executionFinishedAt?: string
  outputs?: unknown[]
}

/**
 * Helper type for blocks that may have outputs
 */
export type BlockWithOutputs = {
  id: string
  type: string
  content?: string
  contentHash?: string
} & Partial<ExecutableBlockFields>

/**
 * Environment info with required hash for snapshots
 */
export type SnapshotEnvironment = NonNullable<Environment> & {
  hash: string
}

/**
 * Execution info with required fields for snapshots
 */
export type SnapshotExecution = NonNullable<Execution> & {
  finishedAt: string
  startedAt: string
}
