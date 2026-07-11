# @deepnote/cloud

Client for the Deepnote Cloud **runs** API (preview): trigger a run of an existing cloud
notebook, poll it to completion, and fetch its execution snapshot.

Shared by `@deepnote/cli` (`deepnote run --cloud`) and `@deepnote/local-runner` (`runInCloud`).

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

Auth is `Authorization: Bearer <token>`. Endpoints: `POST {baseUrl}/v2/runs`,
`GET {baseUrl}/v2/runs/{runId}`. Schemas are permissive (`.passthrough()`) because the API is
in preview and its exact shape may drift.
