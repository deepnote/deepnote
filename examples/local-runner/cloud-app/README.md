# Deepnote app

A self-contained dynamic app that runs notebooks via the Deepnote `/v2/runs` API directly from the browser — no server required.

## How it works

`baseUrl` is the fallback API origin. When published, the trusted Deepnote shell supplies the API
origin together with the app's short-lived token, and the app always uses those as one credential
bundle.

The HTML page embeds all the JS needed to:

1. **Trigger runs** via `POST {baseUrl}/v2/runs`
2. **Poll for results** via `GET {baseUrl}/v2/runs/{runId}?snapshotDelivery=inline`
3. **Parse snapshot YAML** using the `snapshot-reader.iife.js` bundle — except embedded in Deepnote, where the short-lived app token never receives the raw snapshot and the API returns the executed blocks' outputs pre-parsed as `snapshotBlocks`
4. **Render outputs** (tables, charts, text) in the browser

Embedded mode stays within the static-app token's restricted API surface: read the configured
notebook, start a detached run, and poll that run. Notebook discovery and run-history enumeration
are intentionally not available to static-app tokens.

### Configuration

Runtime configuration comes from `APP_CONFIG` in the HTML. The non-sensitive `notebookId` and `shellOrigin` values can also be overridden through query parameters:

| Parameter     | Default                    | Description                                                                  |
| ------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `baseUrl`     | `https://api.deepnote.com` | Fallback API origin; replaced by the shell-provided origin when embedded     |
| `notebookId`  | —                          | Required notebook to run                                                     |
| `shellOrigin` | `https://deepnote.com`     | Origin of the embedding Deepnote shell, pinned so only it can supply a token |
| `inputs`      | `[]`                       | Optional input definitions; empty means discover them from the notebook API  |

With an empty `inputs` array, the app loads normalized input definitions — including select options
and slider bounds — from `GET /v2/notebooks/:id`. It does not request arbitrary block metadata.

### Tokens

When embedded in Deepnote (published and opened from the project), the app asks the shell over
postMessage and uses the short-lived, project- and viewer-scoped token it gets back. The shell also
names the API origin in the same reply, and the app always sends that token only to that origin.
Personal API tokens are not accepted through URL parameters. The preview server below does not
provide API routes, so notebook loading and execution must be tested through the published,
embedded app.

The handshake is pinned to `shellOrigin` in both directions: the request is addressed to that origin
rather than `*`, and a reply is only believed when it comes from the parent frame on that same
origin. Set `shellOrigin` if the app is embedded somewhere other than `deepnote.com`.

Publishing the files is not enough for the embedded path. A project needs **API access for static
apps** enabled, which is a separate opt-in from static file sharing. Without it the shell answers
the handshake with nothing at all, and the app reports that it could not acquire a token.

## Local static preview

```bash
# Build the snapshot reader (once)
pnpm --filter @deepnote/local-runner build

# Start the static preview server (no API routes)
node examples/local-runner/cloud-app/serve.mjs
```

Open the URL printed by the server. This previews the app's assets and layout only; it cannot load
a notebook or start a run. Use the published flow below for functional testing.

## Publishing to deepnote.com

```bash
# 1. Set notebookId in APP_CONFIG inside index.html
# 2. Copy the snapshot reader into this directory
cp packages/local-runner/dist/snapshot-reader.iife.js examples/local-runner/cloud-app/snapshot-reader.js

# 3. Publish with a personal API token and enable the app's Deepnote API access
DEEPNOTE_TOKEN=... deepnote publish examples/local-runner/cloud-app --project-id <your-project-id> --api-access enabled
```

The command enables website sharing and prints the canonical URL. At that URL, the app acquires a
static-app viewer token automatically via `postMessage` — no server or manual token configuration.
