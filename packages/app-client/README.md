# @deepnote/app-client

Browser client for apps published with `deepnote publish`. It is the one code path such an app needs:
the same inside Deepnote and in local preview.

A published app never sees its author's API token. Deepnote's page embeds it and hands it a
short-lived, viewer-scoped token over `postMessage`. That token can make four calls; everything else
answers 403. This client:

- performs the token handshake, with the shell origin pinned in both directions, and sends the token
  only to the API origin returned with it. The shell origin is `https://deepnote.com` unless you pass
  `shellOrigin` (for another deployment); a `?shellOrigin=` in the page URL is honoured only for a
  loopback origin, so another site embedding the app cannot supply its own token
- refreshes the token before its 15-minute expiry, and once more on a 401
- exposes exactly the calls a viewer token can make, so an out-of-scope call can't be written by accident
- turns the viewer-scope 403 into an `AppScopeError` that says what happened
- has no personal-token fallback: outside an embedding shell it fails with a clear error

## Installation

```bash
npm install @deepnote/app-client
```

For a plain HTML app, copy `dist/app-client.iife.js` (exported as `@deepnote/app-client/browser`)
next to your page and load it with a `<script>` tag; it defines `window.DeepnoteApp`.

## Usage

```ts
import { createAppClient, isRunSuccessful } from "@deepnote/app-client";

const client = createAppClient(); // shell origin: https://deepnote.com, or the local preview's

const notebook = await client.getNotebook(notebookId); // inputs and block metadata, no source
const started = await client.startRun(notebookId, { region: "EU" }); // always detached
const run = await client.waitForRun(started.runId, {
  onStatus: (r) => console.log(r.status),
});
if (isRunSuccessful(run)) render(run.snapshotBlocks);

const { appData } = await client.getNotebookAppData(notebookId); // the viewer's latest app data
```

| Method                           | API call                                  |
| -------------------------------- | ----------------------------------------- |
| `getNotebook(notebookId)`        | `GET /v2/notebooks/{notebookId}`          |
| `getNotebookAppData(notebookId)` | `GET /v2/notebooks/{notebookId}/app-data` |
| `startRun(notebookId, inputs?)`  | `POST /v2/runs` with `detached: true`     |
| `getRun(runId)`                  | `GET /v2/runs/{runId}`                    |
| `waitForRun(runId, options?)`    | polls `getRun` until outputs arrive       |

Viewers can poll only runs they started, and cannot list a notebook's run history; keep the IDs of
runs your page starts.

## Developing locally

Run the app with `deepnote publish <dir> --preview --project-id <uuid>`. It embeds the build the way
Deepnote does and gives this client a real viewer token for the project, so it gets the same answers
it will get once published. Without `--project-id`, the viewer token is simulated. See
[Preview an app as a viewer](../../docs/deepnote-cli-publish.md#preview-an-app-as-a-viewer).

## The viewer scope

`VIEWER_SCOPE` lists the routes a viewer token may call. It mirrors Deepnote's hosted app viewer
router, and it drives this client, the simulated `deepnote publish --preview` token, and the warning
`deepnote publish` prints for API paths in a build that viewers cannot call. `matchViewerRoute` and
`findOutOfScopeApiPaths` are exported for tools that need the same check.

Two things keep it honest. A preview with a real token flags any call Deepnote answers differently
from `VIEWER_SCOPE`. And `checkHostedViewerScope` compares it with Deepnote's published API document;
`scripts/check-hosted-scope.mjs` runs that weekly in CI (`.github/workflows/viewer-scope-drift.yml`).
