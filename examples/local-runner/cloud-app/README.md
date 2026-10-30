# Deepnote app

A self-contained dynamic app that runs notebooks via the Deepnote `/v2/runs` API directly from the browser — no server required.

## How it works

The app talks to Deepnote only through [`@deepnote/app-client`](../../../packages/app-client), loaded
from `app-client.js` next to `index.html`. The client:

1. **Asks the embedding shell for a token** over `postMessage`, pinned to `shellOrigin` in both
   directions, and sends that token only to the API origin named in the same reply
2. **Reads the notebook's inputs** via `GET /v2/notebooks/{id}` (no block source)
3. **Starts a detached run** via `POST /v2/runs`
4. **Polls the run** via `GET /v2/runs/{runId}` until its executed blocks arrive as `snapshotBlocks`
5. Refreshes the token before its 15-minute expiry and retries once on a 401

Those are the calls a published app's viewer token may make, and the only ones the client offers.
There is no second code path for a personal token: the app behaves the same in local preview and
once published, and it refuses to run outside an embedding shell. The run list shows runs started
from the page, because viewers cannot list a notebook's run history.

### Configuration

Runtime configuration comes from `APP_CONFIG` in the HTML. `notebookId` and `shellOrigin` can also be
set through query parameters:

| Parameter     | Default                | Description                                                                  |
| ------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `notebookId`  | —                      | Required notebook to run                                                     |
| `shellOrigin` | `https://deepnote.com` | Origin of the embedding Deepnote shell, pinned so only it can supply a token |
| `inputs`      | `[]`                   | Optional input definitions; empty means discover them from the notebook API  |

Publishing the files is not enough for the embedded path. A project needs **API access for apps**
enabled, which is a separate opt-in from app sharing. Without it the shell answers the handshake
with nothing at all, and the app reports that it could not acquire a token.

## Local preview

```bash
# Builds the packages, copies app-client.js next to index.html, and serves a viewer preview
DEEPNOTE_TOKEN=... NOTEBOOK_ID=<notebook-id> pnpm example:cloud-app
```

Open the printed URL. The preview embeds the app the way Deepnote does and hands it a local viewer
token. Calls a viewer can make are forwarded to Deepnote with your `DEEPNOTE_TOKEN`; everything else
answers 403, as it will once published. The bar above the app can expire the token (to exercise
refresh) or revoke API access, and the panel below it logs every API call. `TOKEN_TTL=30` shortens the
token's lifetime.

With the CLI, the same preview is `deepnote publish examples/local-runner/cloud-app --preview`, once
`app-client.js` is in the directory.

## Publishing to deepnote.com

```bash
# 1. Set notebookId in APP_CONFIG inside index.html
# 2. Copy the app client into this directory (the preview above already did)
cp packages/app-client/dist/app-client.iife.js examples/local-runner/cloud-app/app-client.js

# 3. Publish with a personal API token and enable the app's Deepnote API access
DEEPNOTE_TOKEN=... deepnote publish examples/local-runner/cloud-app --project-id <your-project-id> --api-access enabled
```

The command enables app sharing and prints the canonical URL. At that URL, the app acquires a viewer
token automatically via `postMessage` — no server or manual token configuration.
