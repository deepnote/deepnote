# Deepnote app

A self-contained dynamic app that runs notebooks via the Deepnote `/v2/runs` API directly from the browser — no server required.

## How it works

One configurable `baseUrl` determines where standalone runs execute. Point it at a local Deepnote server (`localhost:8080`) for local kernel execution. When published, the trusted Deepnote shell supplies the API origin together with the app's short-lived token, and the app always uses those as one credential bundle.

The HTML page embeds all the JS needed to:

1. **Trigger runs** via `POST {baseUrl}/v2/runs`
2. **Poll for results** via `GET {baseUrl}/v2/runs/{runId}?snapshotDelivery=inline`
3. **Parse snapshot YAML** using the `snapshot-reader.iife.js` bundle — except embedded in Deepnote, where the short-lived app token never receives the raw snapshot and the API returns the executed blocks' outputs pre-parsed as `snapshotBlocks`
4. **Render outputs** (tables, charts, text) in the browser

### Configuration

Runtime configuration comes from `APP_CONFIG` in the HTML. The non-sensitive `notebookId` and `shellOrigin` values can also be overridden through query parameters:

| Parameter     | Default                    | Description                                                                  |
| ------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `baseUrl`     | `https://api.deepnote.com` | Standalone API server; replaced by the shell-provided origin when embedded   |
| `notebookId`  | —                          | Notebook to run                                                              |
| `shellOrigin` | `https://deepnote.com`     | Origin of the embedding Deepnote shell, pinned so only it can supply a token |

### Tokens

When embedded in Deepnote (published and opened from the project), the app asks the shell over
postMessage and uses the short-lived, project- and viewer-scoped token it gets back. The shell also
names the API origin in the same reply, and the app always sends that token only to that origin.
Personal API tokens are not accepted through URL parameters. Standalone development therefore uses
an unauthenticated local Deepnote server configured through `APP_CONFIG.baseUrl`.

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

# Set APP_CONFIG.baseUrl to http://localhost:8080, then open:
# http://127.0.0.1:<port>?notebookId=<id>
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
