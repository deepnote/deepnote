# @deepnote/cloud-sync

Node.js workflows between a local folder and Deepnote Cloud. Today it owns workspace sync
(`syncWorkspace`, the engine behind `deepnote sync`), the sync manifest (`.deepnote-sync.json`) that
it writes, the planning of local paths for synced projects, and Streamlit app registration
(`createOrFindStreamlitApp`). App publishing moves here next.

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

### syncWorkspace

`syncWorkspace(options)` syncs every project of a Deepnote workspace with a local folder: it pulls
cloud edits, pushes local edits, and passes every situation it will not settle on its own to a
conflict policy you supply. The caller passes the root, token and API URL explicitly and receives
progress through an event callback.

```ts
import { syncWorkspace } from "@deepnote/cloud-sync";

const result = await syncWorkspace({
  rootDir: "./deepnote-workspace",
  baseUrl: "https://api.deepnote.com",
  token: apiToken,
  onConflict: async (conflict) => {
    console.log(`${conflict.projectName}: ${conflict.kind}`);
    return "skip";
  },
  onEvent: (event) => {
    if (event.kind === "project-outcome") {
      console.log(event.outcome.action, event.outcome.path);
    }
  },
});
```

It resolves with a `WorkspaceSyncResult`:

- `success` is `false` when any project ended with an `error` outcome. A failing project does not
  reject the call.
- `root` is the resolved absolute root.
- `dryRun` echoes the option.
- `projects` holds one `ProjectSyncOutcome` per cloud project, sorted by path, followed by one for
  each tracked project that is no longer in the cloud.
- `untrackedFiles` lists the local `.deepnote` files under the root, as root-relative POSIX paths,
  that no cloud project maps to. They are left untouched.

It rejects with the underlying error when a workspace-level step fails, such as listing the projects
or reading the sync manifest. With `prune`, it also rejects, leaving local files unchanged, when the
manifest tracks projects and none of them is in the workspace.

The package also exports `DEFAULT_SYNC_CONCURRENCY` and the types `WorkspaceSyncOptions`,
`WorkspaceSyncResult`, `ProjectSyncOutcome`, `SyncConflict`, `SyncConflictDecision`,
`SyncConflictPolicy` and `SyncEvent`.

#### Options

| Option                   | Type                         | Default                        | Description                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`                | `string`                     | required                       | The local folder to sync with. A relative path is resolved against the working directory. The folder is created unless `dryRun` is set.                                                                                             |
| `baseUrl`                | `string`                     | required                       | Base URL of the Deepnote API.                                                                                                                                                                                                       |
| `token`                  | `string`                     | required                       | API token, used as given. It is never looked up in the environment or in `.env` files.                                                                                                                                              |
| `allFiles`               | `boolean`                    | `false`                        | Also sync each project's working-directory files, mirrored in `<projectDir>/.files`.                                                                                                                                                |
| `deleteMissingNotebooks` | `boolean`                    | `false`                        | When pushing, delete cloud notebooks that have no local file.                                                                                                                                                                       |
| `prune`                  | `boolean`                    | `false`                        | Remove local copies of projects, and working files, that no longer exist in Deepnote.                                                                                                                                               |
| `dryRun`                 | `boolean`                    | `false`                        | Report what would happen without writing locally or to Deepnote. A function `onConflict` is not called.                                                                                                                             |
| `concurrency`            | `number`                     | `DEFAULT_SYNC_CONCURRENCY` (8) | How many projects sync at once. Must be a positive integer; any other value rejects with `RangeError` before `rootDir` is created or the API is called. A run that moves a tracked project's directory syncs one project at a time. |
| `onConflict`             | `SyncConflictPolicy`         | `'skip'`                       | How conflicts are decided: `'skip'` or `'override'` for all of them, or a function asked about each. See [Conflicts](#conflicts).                                                                                                   |
| `onEvent`                | `(event: SyncEvent) => void` | none                           | Receives progress. See [Events](#events).                                                                                                                                                                                           |

#### Conflicts

`onConflict` is `'skip'`, `'override'`, or a function
`(conflict: SyncConflict) => Promise<'skip' | 'override'>`. `'skip'` and `'override'` decide every
conflict that way. A function:

- is never called concurrently: calls are queued, one at a time;
- is never called in a dry run, where every conflict it would be asked about is `'skip'`;
- counts any answer other than `'override'` as `'skip'`;
- cancels the run when it rejects. See [Cancellation](#cancellation).

Every conflict has a `kind`, a `projectId` and a `projectName`. `skip` leaves the affected project
as it is and reports it with a `skipped-conflict` outcome. For `working-files-changed`, it leaves
only the listed files out of the upload: the project's other files still sync, the outcome gets a
`filesSkipped` count, and a `warning` event names the files.

| `kind`                           | Extra fields          | Situation                                                                                                                                                                                                                                                                   | What `override` does                                                                |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `empty-local-directory`          | none                  | The project's local directory has no notebooks and `deleteMissingNotebooks` is set, so pushing it would delete every notebook of the cloud project.                                                                                                                         | Pushes anyway and deletes every cloud notebook.                                     |
| `cloud-changed-after-local-edit` | none                  | The project was edited locally, but Deepnote rejected the push (409) because it changed in Deepnote after the last sync. A suspended project is an `error` outcome instead.                                                                                                 | Imports again with `force: true`, replacing the cloud version with the local files. |
| `working-files-changed`          | `projectDir`, `files` | With `allFiles`, working files to upload differ from the Deepnote copies: they changed or were deleted there since the last sync, exist there but were never synced here, or were re-created there after an interrupted upload. One conflict per project lists all of them. | Uploads the local copies over the Deepnote ones.                                    |
| `changed-on-both-sides`          | `projectDir`          | A tracked project changed both locally and in Deepnote since the last sync.                                                                                                                                                                                                 | Pulls the cloud version, discarding the local changes.                              |
| `untracked-local-directory`      | `projectDir`          | The project's local directory exists and differs from the cloud copy, but the sync manifest does not link it to the project.                                                                                                                                                | Pulls the cloud version, replacing the local notebooks.                             |

- `projectDir` is the project's local directory: a POSIX path relative to `rootDir`, e.g.
  `Analytics/Sales report`.
- `files` is a list of `{ path, reason }`. `path` is the working file's project-relative POSIX path:
  its path in Deepnote, and locally relative to `<rootDir>/<projectDir>/.files`, never prefixed with
  `projectDir`, e.g. `_deepnote_static/index.html`. `reason` says why the file conflicts, e.g.
  `changed in Deepnote`, `was deleted in Deepnote`, `exists in Deepnote but was never synced here` or
  `was re-created in Deepnote after an interrupted upload`.

#### Events

| `kind`             | Fields                                                               | Emitted when                                                                                    |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `listing-projects` | `baseUrl`                                                            | The project listing is about to be requested from `baseUrl`.                                    |
| `project-outcome`  | `outcome` (`ProjectSyncOutcome`)                                     | One project finished, was pruned, or is missing in the cloud.                                   |
| `warning`          | `message`                                                            | Something was skipped or kept that the user should know about, e.g. a file with an unsafe path. |
| `file-transferred` | `direction` (`download` or `upload`), `projectName`, `path`, `bytes` | A working file was downloaded or uploaded. In a dry run, it reports what would be transferred.  |

For `file-transferred`, `path` is the working file's project-relative POSIX path, the same as
`files[].path` of a conflict. Outcome events arrive as projects finish, so their order can differ
from `projects` in the result. While a function `onConflict` is pending, events are held and
delivered in order once it settles, so they are never interleaved with a prompt.

#### Cancellation

When a function `onConflict` rejects, for example because the user dismissed a prompt, the run is
cancelled:

- Calls still queued behind it reject with the same error without calling the function.
- No new project or write starts: no import, file download, prune deletion, notebook write,
  directory move or file replacement. The run stops at its next checkpoints.
- Steps already under way finish, including a notebook write batch in progress and a file
  replacement whose delete was already sent: its upload and any cleanup delete still run.
- Unless it is a dry run, a final manifest save is attempted so what finished is kept. A failed save
  is ignored.
- Once every worker has settled, `syncWorkspace` rejects with the error the policy rejected with, and
  no engine work is still running.

### Streamlit apps

`normalizeStreamlitEntrypoint(path)` normalizes a project-relative file path for use as a Streamlit
entrypoint and returns it, or `null` when the path is unsafe: it has leading or trailing whitespace,
contains a NUL byte or a backslash, ends with `/`, has a `..` segment, or normalizes to nothing
(`''`, `.`, `/`). Empty and `.` segments are collapsed and leading slashes stripped, so `/apps/x.py`
becomes `apps/x.py` and `./app.py` becomes `app.py`. The file extension is not checked.

`createOrFindStreamlitApp(baseUrl, token, projectId, entrypoint)` registers the entrypoint as a
Streamlit app of the project, or finds the app that already serves it. Pass an entrypoint from
`normalizeStreamlitEntrypoint`.

```ts
import { waitForStreamlitApp } from "@deepnote/cloud";
import {
  createOrFindStreamlitApp,
  normalizeStreamlitEntrypoint,
} from "@deepnote/cloud-sync";

const entrypoint = normalizeStreamlitEntrypoint("apps/dashboard.py");
if (!entrypoint) {
  throw new Error("Streamlit entrypoint must be a project-relative file path");
}

const { app, created } = await createOrFindStreamlitApp(
  baseUrl,
  token,
  projectId,
  entrypoint,
);
await waitForStreamlitApp(baseUrl, token, app.id, {
  onStatus: (status) => console.log(status),
});
console.log(created ? "Created" : "Already served by", app.url);
```

It resolves with a `PublishedStreamlitApp`, `{ app, created }`: `created` is `true` for a new app and
`false` when an app for the entrypoint already existed, in which case nothing was changed.

- **Creating an app restarts the project machine**, which interrupts anyone working in the project.
- **Waiting is separate.** Wait for the app to run with `waitForStreamlitApp` from `@deepnote/cloud`.
- **Errors:** when creation fails because an app for the entrypoint already exists (409) but the
  project's app list has no match, it rejects with that original `ApiError`. Every other failure,
  including a failing list call, rejects with the underlying error.

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

| Export                             | Description                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `projectFilesDir(projectDir)`      | The root-relative working-file mirror for a project directory: `<projectDir>/.files`.                                         |
| `isSafeRelativeFilePath(filePath)` | Whether a cloud-reported path is relative with no empty, `.` or `..` segments, so it is safe to join under a local directory. |
