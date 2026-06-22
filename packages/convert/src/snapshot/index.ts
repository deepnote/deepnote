// Hash utilities

export type { SnapshotHashInput } from '@deepnote/blocks'
export { addContentHashes, computeContentHash, computeSnapshotHash } from './hash'
// Lookup utilities
export {
  findSnapshotsForProject,
  getSnapshotDir,
  loadLatestSnapshot,
  loadSnapshotFile,
  parseSnapshotFilename,
  parseSourceFilePath,
  snapshotExists,
} from './lookup'
export type { MarimoConsoleOutput, MarimoSessionCache, MarimoSessionCell, MarimoSessionOutput } from './marimo-outputs'
// Marimo output extraction
export {
  convertMarimoConsoleToJupyter,
  convertMarimoOutputToJupyter,
  convertMarimoSessionCellToOutputs,
  findMarimoSessionCache,
  getMarimoOutputsFromCache,
  readMarimoSessionCache,
} from './marimo-outputs'

// Merge utilities
export { countBlocksWithOutputs, mergeSnapshotIntoSource } from './merge'
// Init resolution & composition
export type { ResolveAndComposeInitResult } from './resolve-init'
export { InitNotebookResolutionError, resolveAndComposeInit, resolveAndComposeInitIfNeeded } from './resolve-init'
// Execution snapshot persistence
export type {
  BlockExecutionOutput,
  ExecutionTiming,
  SaveExecutionSnapshotResult,
} from './save-execution-snapshot'
export { mergeOutputsIntoFile, saveExecutionSnapshot } from './save-execution-snapshot'
// Snapshot notebook-id resolution
export type { SnapshotNotebookIdFileInput, SnapshotNotebookIdProjectInput } from './snapshot-notebook-id'
export { resolveSnapshotNotebookId } from './snapshot-notebook-id'
// Split utilities
export type { GenerateSnapshotFilenameParams } from './split'
export {
  generateSnapshotFilename,
  hasOutputs,
  slugifyProjectName,
  splitByNotebooks,
  splitDeepnoteFile,
  stripOutputsFromBlock,
} from './split'
export type {
  BlockOutput,
  BlockWithOutputs,
  ExecutableBlockFields,
  MergeOptions,
  NotebookSplitEntry,
  SnapshotEnvironment,
  SnapshotExecution,
  SnapshotInfo,
  SnapshotOptions,
  SplitResult,
} from './types'
