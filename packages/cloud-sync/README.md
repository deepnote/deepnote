# @deepnote/cloud-sync

Node.js workflows between a local folder and Deepnote Cloud: workspace sync, the sync manifest, app
publishing, and Streamlit app registration.

Used by `@deepnote/cli`.

## Installation

```bash
npm install @deepnote/cloud-sync
```

## Usage

```ts
import { syncWorkspace } from "@deepnote/cloud-sync";

const result = await syncWorkspace({
  rootDir: "./deepnote-workspace",
  baseUrl: "https://api.deepnote.com",
  token: apiToken,
  onConflict: "skip",
  onEvent: (event) => console.log(event.kind),
});
```

Publish a build directory as the project's app. Inside a synced folder, the publish also updates the
sync mirror.

```ts
import { publishApp } from "@deepnote/cloud-sync";

const result = await publishApp({
  dir: "./dist",
  projectId,
  baseUrl: "https://api.deepnote.com",
  token: apiToken,
  onEvent: (event) => console.log(event.kind),
});
```

Register a Streamlit app and wait for it. Creating an app restarts the project machine.
`waitForStreamlitApp` is in `@deepnote/cloud`, which is not re-exported here.

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
const { app } = await createOrFindStreamlitApp(
  baseUrl,
  token,
  projectId,
  entrypoint,
);
await waitForStreamlitApp(baseUrl, token, app.id);
```

## API reference

Options, conflict kinds, events and result shapes are documented on the exported types.

| Export                                                                                                      | Description                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `syncWorkspace(options)`                                                                                    | Sync every project of a workspace with a local folder; conflicts go to the `onConflict` policy.                        |
| `publishApp(options)`                                                                                       | Upload a directory into the project's app folder and enable sharing. Failed operations are listed in `errors`.         |
| `normalizeStreamlitEntrypoint(path)`                                                                        | Normalize a project-relative file path, or `null` if it is unsafe.                                                     |
| `createOrFindStreamlitApp(baseUrl, token, projectId, entrypoint)`                                           | Create the Streamlit app, or find the one that already serves the entrypoint (`created: false`).                       |
| `findSyncManifestRoot`, `hasSyncManifest`, `loadSyncManifest`, `saveSyncManifest`, `SYNC_MANIFEST_FILENAME` | Detect, read and write the `.deepnote-sync.json` manifest. Use these instead of parsing the JSON directly.             |
| `projectFilesDir`, `isSafeRelativeFilePath`, `assertNoSymbolicLinkAncestors`, `baselineDiverged`, `sha256`  | Local path and fingerprint helpers used by the sync engine.                                                            |
| `PublishError`                                                                                              | Thrown by `publishApp` before any file changes: invalid input or an unavailable project (`reason`, `code`).            |
| `PublishDivergedError`                                                                                      | Thrown by `publishApp` before any file changes when files changed in Deepnote since the last sync, unless `force`.     |
| `PublishMirrorError`                                                                                        | An unusable sync folder. `publishApp` rethrows one found before uploading as `PublishError` with its `code`.           |
| `ApiError`                                                                                                  | Thrown by API calls with the HTTP status in `statusCode`. Network failures and timeouts are the platform's own errors. |

## Messages and CLI hints

No message this package throws, emits or returns names a CLI flag. Where a message used to end in a flag
hint, the condition is marked in a field instead, together with an `OptionHint`: the library option
that resolves it (`{ option: 'syncRoot', value: false }` or `{ option: 'prune', value: true }`).
Library callers apply the option; `deepnote publish` and `deepnote sync` translate the hint into the
matching flag and append it to the message they print.

| Condition                                                                                 | Marked by                                      | Hint                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| The sync folder cannot be used (invalid or symlinked manifest, unreadable tracked folder) | `PublishError.code` `sync-root-unusable`       | `PublishError.hint`: `syncRoot: false`         |
| An explicit `syncRoot` does not track the project, or its project folder is missing       | `PublishError.code` `project-not-in-sync-root` | `PublishError.hint`: `syncRoot: false`         |
| Files deleted in Deepnote are kept locally (`allFiles`, no `prune`)                       | `warning` event `code` `deleted-files-kept`    | The event's `hint`: `prune: true` removes them |
| A project deleted in Deepnote was kept locally because `prune` is off                     | `missing-in-cloud` outcome (`action`)          | The outcome's `hint`: `prune: true` removes it |

A `pruned` outcome and a `missing-in-cloud` outcome that `prune` kept because a current cloud project uses its
path carry no hint: there is nothing for the caller to change. Without `prune`, such an outcome still carries the
`prune: true` hint, but pruning then only drops its manifest record and keeps the directory.

Other messages name the option in words: "API URL" is `baseUrl`, and the "working-file transfer limit"
applies to `allFiles`.

## Package vs. CLI

**In this package:** logic that reads or writes the synced folder or calls Deepnote Cloud, and the
decisions about it.

- Inputs are arguments: token, base URL and paths. Nothing reads environment variables or `.env`.
- Results are return values, failures are thrown errors, progress is an event callback, and a
  decision such as a conflict is a callback.
- No console output, `process.exit` or exit codes.

**In the CLI:** argument parsing, token resolution (flags, environment, `.env`), prompts, spinners,
output formatting (including `-o json`), user-facing error wording, and exit codes.

If a second consumer would need the same code, it belongs here. If it is about how a terminal
presents or interrupts the work, it stays in the CLI.
