export {
  assertNoSymbolicLinkAncestors,
  baselineDiverged,
  findSyncManifestRoot,
  hasSyncManifest,
  loadSyncManifest,
  type ManifestFileRecord,
  type ManifestProjectRecord,
  SYNC_MANIFEST_FILENAME,
  type SyncManifest,
  saveSyncManifest,
  sha256,
} from './sync-manifest'
export {
  isSafeRelativeFilePath,
  type PlannedProjectPaths,
  pathsOverlap,
  planProjectPaths,
  projectFilesDir,
} from './sync-paths'
