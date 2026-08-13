# Cloud app

A self-contained dynamic app that calls the Deepnote API directly from the browser — no server required for cloud execution.

## How it works

The HTML page embeds all the JS needed to:

1. **Trigger cloud runs** via `POST /v2/runs`
2. **Poll for results** via `GET /v2/runs/{runId}?snapshotDelivery=inline`
3. **Parse snapshot YAML** using the `snapshot-reader.iife.js` bundle
4. **Render outputs** (tables, charts, text) in the browser

### Token acquisition

| Environment                                         | How the token is obtained                                            |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| **deepnote.com** (published via `deepnote publish`) | postMessage to the Deepnote shell — automatic, no user action needed |
| **Localhost**                                       | `?token=<DEEPNOTE_TOKEN>` query parameter                            |

### Optional local server

For local development, `serve.mjs` provides:

- `/api/info` — notebook name + input metadata from the `.deepnote` file
- `/api/run` — local Python execution (needs a Python env + `OPENAI_API_KEY` for the demo notebook)
- `/snapshot-reader.js` — the built YAML parser, resolved from `packages/local-runner/dist`

When the page detects a local server at `/api/info`, it shows the **Run locally** button alongside **Run in cloud**.

## Quick start

```bash
# Build the snapshot reader (once)
pnpm --filter @deepnote/local-runner build

# Start the local dev server
node examples/local-runner/cloud-app/serve.mjs

# Open in browser — pass a token for cloud runs
# http://127.0.0.1:<port>?token=<your-deepnote-token>
```

## Publishing to deepnote.com

```bash
# 1. Set your notebook id in APP_CONFIG inside index.html
# 2. Copy the snapshot reader into this directory
cp packages/local-runner/dist/snapshot-reader.iife.js examples/local-runner/cloud-app/snapshot-reader.js

# 3. Publish
deepnote publish examples/local-runner/cloud-app --project-id <your-project-id>
```

Once published, the app runs on `static-<projectId>.outputs.deepnoteworkspace.com` and acquires a token automatically via postMessage — no server, no manual token configuration.
