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
// Split utilities
export type { GenerateSnapshotFilenameParams } from './split'
export {
  generateSnapshotFilename,
  generateSplitFilename,
  hasOutputs,
  slugifyProjectName,
  splitByNotebooks,
  splitDeepnoteFile,
  splitSnapshotByNotebooks,
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
