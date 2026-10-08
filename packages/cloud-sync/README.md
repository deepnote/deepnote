# @deepnote/cloud-sync

Node.js workflows between a local folder and Deepnote Cloud. Today it owns the sync manifest
(`.deepnote-sync.json`) that `deepnote sync` writes, the planning of local paths for synced
projects, and app publishing (`publishApp`). Workspace sync and Streamlit app registration move
here next.

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

Publish a build directory as a project's static app:

```ts
import { PublishDivergedError, publishApp } from "@deepnote/cloud-sync";

try {
  const result = await publishApp({
    dir: "./dist",
    projectId,
    baseUrl: "https://api.deepnote.com",
    token,
    onEvent: (event) => console.log(event.kind),
  });
  console.log(result.appUrl ?? result.errors);
} catch (error) {
  if (error instanceof PublishDivergedError) {
    // Deepnote holds changes the local sync folder has not seen; sync first or pass `force: true`.
    console.error(error.paths);
  }
}
```

`publishApp` never prints and never sets an exit code: it reports progress through `onEvent`,
returns the outcome, and throws the typed errors below.

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
| `pathsOverlap(left, right)`        | Whether two root-relative paths are equal or nested, compared case-insensitively.                                                 |
| `isSafeRelativeFilePath(filePath)` | Whether a cloud-reported path is relative with no empty, `.` or `..` segments, so it is safe to join under a local directory.     |
| `PlannedProjectPaths`              | Type of a planned entry: `{ projectDir, filesDir }`.                                                                              |

### Publishing

`publishApp(options)` uploads every file below `dir` into a project's app folder, makes sure the
app is shared, and keeps the sync mirror up to date when `dir` is inside a synced folder.
Files that fail to upload do not throw: they are reported through `onEvent` and listed in
`result.errors`, and sharing is only enabled when there are none.

#### Options

| Option       | Type                               | Description                                                                                                                                |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `dir`        | `string`                           | Local build directory. Every file below it is uploaded; `.env` and `.env.*` files are refused.                                             |
| `projectId`  | `string`                           | Project to publish into.                                                                                                                   |
| `baseUrl`    | `string`                           | Deepnote API base URL.                                                                                                                     |
| `token`      | `string`                           | API token.                                                                                                                                 |
| `targetPath` | `string`                           | Folder to publish into: `_deepnote_static` (default) or a directory below it.                                                              |
| `apiAccess`  | `boolean`                          | Turn embedded API access on or off. `undefined` leaves the project's setting unchanged.                                                    |
| `prune`      | `boolean`                          | Remove files below `targetPath` that are not in `dir`. Files that block an upload go first; the rest only after every operation succeeded. |
| `force`      | `boolean`                          | Overwrite files that changed in Deepnote since the sync mirror last recorded them.                                                         |
| `syncRoot`   | `string \| false`                  | Sync folder to update. `undefined` searches upwards from `dir`; `false` never updates a mirror.                                            |
| `onEvent`    | `(event: PublishAppEvent) => void` | Progress listener. It must not throw.                                                                                                      |

#### Events

| `kind`              | Fields                                 | Emitted                                                                                           |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `publishing`        | `fileCount`, `targetPath`, `projectId` | Once the project has loaded, before any file is deleted or uploaded.                              |
| `file-removed`      | `path`                                 | A project file was deleted by `prune`. `path` is the project path.                                |
| `file-uploaded`     | `path`                                 | A file was uploaded. `path` is relative to `dir`.                                                 |
| `operation-failed`  | `operation`, `path`, `message`         | A removal (`remove`), upload (`upload`) or the sharing update (`enable-sharing`) failed.          |
| `mirror-skipped`    | `projectDir`                           | A discovered sync folder tracks the project, but its project directory does not exist.            |
| `mirror-incomplete` | `syncRoot`, `failures`                 | Files were published, but the mirror could not be fully updated. Emitted before the sharing step. |

#### Result

| Field              | Type                                  | Description                                                                                                                           |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`        | `string`                              | The project published to.                                                                                                             |
| `targetPath`       | `string`                              | The normalized target folder.                                                                                                         |
| `totalFiles`       | `number`                              | Files found in `dir`.                                                                                                                 |
| `uploaded`         | `number`                              | Files uploaded.                                                                                                                       |
| `pruned`           | `number`                              | Project files removed.                                                                                                                |
| `errors`           | `{ path: string; message: string }[]` | Failed operations. `path` is the project path for removals, the path relative to `dir` for uploads, or `project settings`.            |
| `syncRoot`         | `string \| undefined`                 | The sync folder whose mirror applied, if any.                                                                                         |
| `mirrorUpdated`    | `boolean`                             | Whether a sync mirror applied, updating it raised no failure, and at least one file was uploaded or removed. Independent of `errors`. |
| `appUrl`           | `string \| undefined`                 | The app's URL. Set only when `errors` is empty.                                                                                       |
| `apiAccessEnabled` | `boolean \| undefined`                | The project's API access setting after the publish. Set together with `appUrl`.                                                       |

#### Errors

| Error                  | Properties          | Thrown when                                                                                                                                                                                                                                        |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PublishError`         | `reason`            | `invalid-input`: a bad `targetPath`, a missing, empty or non-directory `dir`, a `.env` file, colliding paths, or an unusable sync folder. `unreadable-directory`: `dir` could not be read. `project-unavailable`: the project could not be loaded. |
| `PublishDivergedError` | `syncRoot`, `paths` | Without `force`, files Deepnote changed since the sync folder last recorded them would be overwritten. `paths` is sorted. Thrown before any file is deleted or uploaded.                                                                           |
