/**
 * Output persistence utilities for saving execution snapshots.
 *
 * This module re-exports snapshot utilities from @deepnote/runtime-core.
 * The implementations have been moved to the runtime-core package for
 * reuse across CLI, VS Code extension, and other consumers.
 */

// Re-export types
export type { BlockExecutionOutput, ExecutionTiming, SaveSnapshotResult } from '@deepnote/runtime-core'

// Re-export functions
export { getSnapshotPath, mergeOutputsIntoFile, saveExecutionSnapshot } from '@deepnote/runtime-core'
