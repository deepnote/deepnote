# @deepnote/cloud

Client for the Deepnote Cloud **runs** API (preview): trigger a run of an existing cloud notebook,
poll it to completion, and fetch its execution snapshot.

Used by `deepnote run --cloud` (`@deepnote/cli`) and by `@deepnote/local-runner`.

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

| Export                                                                                    | Description                                                                                                    |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `triggerNotebookRun(baseUrl, token, body)`                                                | `POST /v2/runs` — start a run of an existing notebook. Returns the normalized run.                             |
| `getRun(baseUrl, token, runId, options?)`                                                 | `GET /v2/runs/{runId}` — fetch a run's current state.                                                          |
| `pollRunUntilComplete(baseUrl, token, runId, opts?)`                                      | Poll until the run reaches a terminal status. Retries transient failures; enforces a deadline.                 |
| `fetchSnapshotContent(run, options)`                                                      | Return the run's snapshot YAML, from inline content or a `downloadUrl`. `null` if it has none.                 |
| `describeRunError(run)`                                                                   | A human-readable message for a failed run, if the API supplied one.                                            |
| `isTerminalStatus` / `isSuccessStatus` / `isFailedStatus`                                 | Status classifiers. Unknown statuses are treated as non-terminal, so a drifting API cannot hang.               |
| `RUN_STATUSES`, `RunStatus`                                                               | The known run statuses.                                                                                        |
| `RunTimeoutError`                                                                         | Thrown when `pollRunUntilComplete` exceeds its deadline. Carries the `runId` — the run may still be executing. |
| `NormalizedRun`, `TriggerRunBody`, `GetRunOptions`, `PollOptions`, `FetchSnapshotOptions` | Types.                                                                                                         |

**Note on `fetchSnapshotContent`:** the bearer token is sent only when the download URL is
same-origin with `baseUrl`. A cross-origin URL (e.g. a presigned S3 link) is fetched without auth,
so the token is never leaked to a third-party host.

## License

Apache-2.0
