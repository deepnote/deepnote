# Deepnote app

A self-contained dynamic app that runs notebooks via the Deepnote `/v2/runs` API directly from the browser — no server required.

## How it works

One configurable `baseUrl` determines where runs execute. Point it at `api.deepnote.com` for cloud execution, or at a local Deepnote server (`localhost:8080`) for local kernel execution. Same API surface either way — `/v2/runs`, `/v2/runs/{id}`, `/v2/notebooks/{id}/runs`. It cannot be both; the app runs against one target at a time.

The HTML page embeds all the JS needed to:

1. **Trigger runs** via `POST {baseUrl}/v2/runs`
2. **Poll for results** via `GET {baseUrl}/v2/runs/{runId}?snapshotDelivery=inline`
3. **Parse snapshot YAML** using the `snapshot-reader.iife.js` bundle — except embedded in Deepnote, where the short-lived app token never receives the raw snapshot and the API returns the executed blocks' outputs pre-parsed as `snapshotBlocks`
4. **Render outputs** (tables, charts, text) in the browser

### Configuration

Everything is configurable via query params or by editing `APP_CONFIG` in the HTML:

| Parameter     | Default                    | Description                                                                      |
| ------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `baseUrl`     | `https://api.deepnote.com` | API server — cloud or local                                                      |
| `notebookId`  | —                          | Notebook to run                                                                  |
| `token`       | —                          | Bearer token (not needed on deepnote.com or against a local server without auth) |
| `shellOrigin` | `https://deepnote.com`     | Origin of the embedding Deepnote shell, pinned so only it can supply a token     |

### Tokens

The app takes its credential from wherever it is running, and never mixes the two:

- **Embedded in Deepnote** (published, and opened from the project) it asks the shell over
  postMessage and uses the short-lived, project- and viewer-scoped token it gets back. `?token=` is
  not consulted — a personal token does not belong in a published app's URL. The shell also names
  the API origin in its reply, so review apps and single-tenant installs need no rebuild.
- **Anywhere else** — from disk, or a local server — it uses `?token=`.

The handshake is pinned to `shellOrigin` in both directions: the request is addressed to that origin
rather than `*`, and a reply is only believed when it comes from the parent frame on that same
origin. Set `shellOrigin` if the app is embedded somewhere other than `deepnote.com`.

Publishing the files is not enough for the embedded path. A project needs **API access for static
apps** enabled, which is a separate opt-in from static file sharing. Without it the shell answers
the handshake with nothing at all, and the app reports that it could not acquire a token.

## Quick start

```bash
# Build the snapshot reader (once)
pnpm --filter @deepnote/local-runner build

# Start the dev server (just serves static files + snapshot-reader.js)
node examples/local-runner/cloud-app/serve.mjs

# Cloud execution
# http://127.0.0.1:<port>?notebookId=<id>&token=<your-deepnote-token>

# Local Deepnote server
# http://127.0.0.1:<port>?notebookId=<id>&baseUrl=http://localhost:8080
```

## Publishing to deepnote.com

```bash
# 1. Set notebookId in APP_CONFIG inside index.html
# 2. Copy the snapshot reader into this directory
cp packages/local-runner/dist/snapshot-reader.iife.js examples/local-runner/cloud-app/snapshot-reader.js

# 3. Publish
deepnote publish examples/local-runner/cloud-app --project-id <your-project-id>
```

Once published, the app runs on `static-<projectId>.outputs.deepnoteworkspace.com` and acquires a token automatically via postMessage — no server, no manual token configuration.
