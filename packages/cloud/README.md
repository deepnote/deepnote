# @deepnote/cloud

Client for the Deepnote Cloud API (preview): create notebooks, trigger a run, poll it to completion,
and fetch its execution snapshot.

Used by `deepnote run --cloud` (`@deepnote/cli`) and by `@deepnote/local-runner`.

A thin client on purpose — it deals in ids and plain shapes, not `.deepnote` domain types, so callers
map their own content onto {@link ProjectSpec}.

## Installation

```bash
npm install @deepnote/cloud
```

## Usage

```ts
import {
  triggerNotebookRun,
  pollRunUntilComplete,
  fetchSnapshotContent,
} from "@deepnote/cloud";

const started = await triggerNotebookRun(baseUrl, token, {
  notebookId,
  inputs,
  blockIds,
});
const run = await pollRunUntilComplete(baseUrl, token, started.runId, {
  snapshotDelivery: "inline",
});
const snapshotYaml = await fetchSnapshotContent(run, { baseUrl, token });
```

Auth is `Authorization: Bearer <token>`. Endpoints: `POST {baseUrl}/v2/runs` and
`GET {baseUrl}/v2/runs/{runId}`. Response schemas are permissive (`.passthrough()`) because the API
is in preview and its exact shape may drift. Failures throw `ApiError`
(from `@deepnote/database-integrations`).

## API reference

| Export                                                                                    | Description                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createProject(baseUrl, token, spec, opts?)`                                              | Create a project, its notebooks, and their blocks; returns the ids Deepnote assigned. See below.                                                             |
| `triggerNotebookRun(baseUrl, token, body)`                                                | `POST /v2/runs` — start a run of an existing notebook. Returns the normalized run.                                                                           |
| `getRun(baseUrl, token, runId, options?)`                                                 | `GET /v2/runs/{runId}` — fetch a run's current state.                                                                                                        |
| `pollRunUntilComplete(baseUrl, token, runId, opts?)`                                      | Poll until the run reaches a terminal status. Retries transient failures; enforces a deadline.                                                               |
| `fetchSnapshotContent(run, options)`                                                      | Return the run's snapshot YAML, from inline content or a `downloadUrl`. `null` if it has none.                                                               |
| `describeRunError(run)`                                                                   | A human-readable message for a failed run, if the API supplied one.                                                                                          |
| `isTerminalStatus` / `isSuccessStatus` / `isFailedStatus`                                 | Status classifiers. Unknown statuses are treated as non-terminal, so a drifting API cannot hang.                                                             |
| `RUN_STATUSES`, `RunStatus`                                                               | The known run statuses.                                                                                                                                      |
| `RunTimeoutError`                                                                         | Thrown when `pollRunUntilComplete` exceeds its deadline. Carries the `runId` — the run may still be executing.                                               |
| `NormalizedRun`, `TriggerRunBody`, `GetRunOptions`, `PollOptions`, `FetchSnapshotOptions` | Types.                                                                                                                                                       |
| `listAllProjects(baseUrl, token, opts?)`                                                  | `GET /v2/projects` — every project in the workspace, walking pagination to exhaustion.                                                                       |
| `getProjectDetail(baseUrl, token, projectId, opts?)`                                      | `GET /v2/projects/{id}` — one project, including its working-directory file inventory.                                                                       |
| `exportProject(baseUrl, token, projectId, opts?)`                                         | `GET /v2/projects/{id}/export` — the project's notebooks as deterministic `.deepnote` documents (unzipped from the export ZIP, one per notebook). See below. |
| `importProject(baseUrl, token, projectId, files, opts?)`                                  | `POST /v2/projects/{id}/import` — reconcile a ZIP of `.deepnote` documents (the exact inverse of export) into the project. See below.                        |
| `uploadProjectFile(baseUrl, token, projectId, path, bytes, opts?)`                        | `POST /v2/files` — upload one working-directory file (multipart). Does not overwrite; delete first. Buffered transfers are limited to 100 MiB.               |
| `deleteProjectFile(baseUrl, token, projectId, path, opts?)`                               | `DELETE /v2/files` — delete one working-directory file; `false` if it did not exist.                                                                         |
| `downloadProjectFile(baseUrl, token, projectId, path, opts?)`                             | `GET /v2/files/download` — raw bytes of one working-directory file. Buffered transfers are limited to 100 MiB.                                               |

**Note on `exportProject`:** the export is a ZIP with one `.deepnote` document per notebook, each
carrying the full project envelope and a shared `metadata.modifiedAt`. `exportProject` unzips it and
returns the documents (`{ filename, content }[]`, sorted by filename). The **documents** are
byte-deterministic for an unchanged project — the ZIP container is not — so compute change
fingerprints over the documents, not the archive.

**Note on `importProject`:** sends a ZIP with one `.deepnote` document per notebook, matching the
export shape. Pass the export's `metadata.modifiedAt` as `baseModifiedAt` to detect structural
changes (notebooks created/deleted/renamed, other imports), and a content hash as `baseContentHash`
to also detect editor block edits, which never advance the timestamp; on either mismatch the server
rejects the import with a 409 (lost-update protection), and `force` skips both checks. Imports
reconcile by notebook id (unmatched notebooks are created, missing ones are deleted only with
`deleteMissingNotebooks`; an empty ZIP imports no notebooks, or deletes every notebook under that
flag). Every document must belong to the target project and agree on project name and integration
attachments. The shared name is applied, and a present `project.integrations` list reconciles the
project's attachments (`[]` detaches all; an absent field leaves them unchanged). Integration
credentials and `settings.requirements` are never imported.

**Note on `fetchSnapshotContent`:** the bearer token is sent only when the download URL is
same-origin with `baseUrl`. A cross-origin URL (e.g. a presigned S3 link) is fetched without auth,
so the token is never leaked to a third-party host.

**Note on `createProject`:** this is the headless counterpart to `uploadNotebook`, which uses the
unauthenticated `/v1/import` endpoint and therefore has to be finished in a browser. With a token,
prefer `createProject` — it returns the new ids, so you can run the notebook immediately.

Two API details leak through it. `POST /v2/projects` seeds a new project with an empty placeholder
notebook, which `createProject` deletes once yours exist (there is no endpoint to rename one); a
placeholder it cannot delete is reported via `onWarning` rather than failing the create. And there is
no bulk block endpoint, so blocks cost one sequential request each — use `onProgress` to report that
on a large notebook. A create that fails midway leaves partial content: there is no transaction.

## License

Apache-2.0
