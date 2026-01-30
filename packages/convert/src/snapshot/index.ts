// Hash utilities
export { addContentHashes, computeContentHash, computeSnapshotHash } from './hash'

// Pure path utilities (kept for backwards compatibility)
// Note: File I/O functions have been moved to @deepnote/runtime-core
export { getSnapshotDir, parseSnapshotFilename, parseSourceFilePath } from './lookup'

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
// Split utilities
export { generateSnapshotFilename, hasOutputs, slugifyProjectName, splitDeepnoteFile } from './split'
export type {
  BlockOutput,
  BlockWithOutputs,
  ExecutableBlockFields,
  MergeOptions,
  SnapshotEnvironment,
  SnapshotExecution,
  SnapshotInfo,
  SnapshotOptions,
  SplitResult,
} from './types'
