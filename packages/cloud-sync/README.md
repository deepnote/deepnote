# @deepnote/cloud-sync

Node.js workflows between a local folder and Deepnote Cloud. Today it owns the sync manifest
(`.deepnote-sync.json`) that `deepnote sync` writes and the planning of local paths for synced
projects. Workspace sync, app publishing and Streamlit app registration move here next.

Used by `@deepnote/cli`.

This package is Node-only. It takes the API token and base URL as arguments and never reads
environment variables or `.env` files.

## Installation

```bash
npm install @deepnote/cloud-sync
```

## Usage

Detect a synced folder and read what it tracks:

```ts
import { findSyncManifestRoot, loadSyncManifest } from "@deepnote/cloud-sync";

const root = await findSyncManifestRoot(process.cwd());
if (root) {
  const manifest = await loadSyncManifest(root);
  for (const [projectId, record] of Object.entries(manifest.projects)) {
    console.log(projectId, record.dir, record.notebooks);
  }
}
```

The manifest read API (`SYNC_MANIFEST_FILENAME`, `findSyncManifestRoot`, `hasSyncManifest`,
`loadSyncManifest` and the manifest types) is the supported way to detect and read synced folders.
The manifest is plain JSON (`version: 1`); do not parse it directly.

## API reference

### Sync manifest

| Export                                            | Description                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_MANIFEST_FILENAME`                          | The manifest's filename, `.deepnote-sync.json`.                                                                                                                                           |
| `findSyncManifestRoot(startDir)`                  | The nearest directory at or above `startDir` that contains a manifest, or `undefined`. Rejects if a manifest on the way up is a symbolic link.                                            |
| `hasSyncManifest(rootDir)`                        | Whether `rootDir` directly contains a manifest. Rejects a manifest that is a symbolic link.                                                                                               |
| `loadSyncManifest(rootDir)`                       | Read and validate the manifest in `rootDir`. Returns an empty manifest when none exists; throws if it is unreadable, malformed, or unsafe.                                                |
| `saveSyncManifest(rootDir, manifest)`             | Write the manifest with project ids, file paths, notebooks and pending uploads sorted, so repeated syncs produce stable, git-diffable output. Rejects a manifest that is a symbolic link. |
| `sha256(content)`                                 | Hex SHA-256 used for the manifest's content fingerprints.                                                                                                                                 |
| `baselineDiverged(baseline, remote)`              | Whether a baseline that recorded `updatedAt` no longer matches the cloud inventory entry (`updatedAt` or `size` differs). Always `false` for a baseline without `updatedAt`.              |
| `assertNoSymbolicLinkAncestors(rootDir, relPath)` | Throw if any existing segment of the root-relative path is a symbolic link.                                                                                                               |
| `SyncManifest`                                    | Type of the parsed manifest: `{ version: 1, projects }`.                                                                                                                                  |
| `ManifestProjectRecord`                           | Type of one project's record: local `dir`, synced `notebooks`, `contentHash`, and optional `modifiedAt`, `files` and `pendingFileUploads`.                                                |
| `ManifestFileRecord`                              | Type of one synced file's record: `size`, and optional `updatedAt` and `hash`.                                                                                                            |

### Local paths

| Export                             | Description                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `planProjectPaths(projects)`       | Map every cloud project to a deterministic, collision-free local directory (`<folder path>/<project name>`), keyed by project id. |
| `projectFilesDir(projectDir)`      | The root-relative working-file mirror for a project directory: `<projectDir>/.files`.                                             |
| `pathsOverlap(left, right)`        | Whether two root-relative paths are equal or nested, compared case-insensitively.                                                 |
| `isSafeRelativeFilePath(filePath)` | Whether a cloud-reported path is relative with no empty, `.` or `..` segments, so it is safe to join under a local directory.     |
| `PlannedProjectPaths`              | Type of a planned entry: `{ projectDir, filesDir }`.                                                                              |
