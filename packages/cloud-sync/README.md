# @deepnote/cloud-sync

Node.js workflows between a local folder and Deepnote Cloud: workspace sync, the sync manifest, and
Streamlit app registration.

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
| `normalizeStreamlitEntrypoint(path)`                                                                        | Normalize a project-relative file path, or `null` if it is unsafe.                                                     |
| `createOrFindStreamlitApp(baseUrl, token, projectId, entrypoint)`                                           | Create the Streamlit app, or find the one that already serves the entrypoint (`created: false`).                       |
| `findSyncManifestRoot`, `hasSyncManifest`, `loadSyncManifest`, `saveSyncManifest`, `SYNC_MANIFEST_FILENAME` | Detect, read and write the `.deepnote-sync.json` manifest. Use these instead of parsing the JSON directly.             |
| `projectFilesDir`, `isSafeRelativeFilePath`, `assertNoSymbolicLinkAncestors`, `baselineDiverged`, `sha256`  | Local path and fingerprint helpers used by the sync engine.                                                            |
| `ApiError`                                                                                                  | Thrown by API calls with the HTTP status in `statusCode`. Network failures and timeouts are the platform's own errors. |

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
