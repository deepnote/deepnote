# Deepnote app

A self-contained dynamic app that runs notebooks via the Deepnote `/v2/runs` API directly from the browser — no server required.

## How it works

The app talks to Deepnote only through the app client Deepnote serves at
`https://deepnote.com/static/app-client/v1.js`, loaded first in the page's `<head>`. The client:

1. **Asks the embedding Deepnote page for a token** over `postMessage`, and sends it only to the API
   origin named in the same reply
2. **Reads the notebook's inputs** via `GET /v2/notebooks/{id}` (no block source)
3. **Starts a detached, read-only run** via `POST /v2/runs`
4. **Polls the run** via `GET /v2/runs/{runId}` until its executed blocks arrive as `snapshotBlocks`
5. Refreshes the token before its 15-minute expiry

Those are the calls a published app's viewer token may make, and the only ones the client offers.
There is no second code path for a personal token: the app behaves the same wherever it runs, and
outside an embedding Deepnote page the handshake goes unanswered and the calls fail. The run list
shows runs started from the page, because viewers cannot list a notebook's run history, and
selecting one redraws the run the page already holds.

### Configuration

Runtime configuration comes from `APP_CONFIG` in the HTML. `notebookId` can also be set through a query
parameter.

| Parameter    | Default | Description                                                                 |
| ------------ | ------- | --------------------------------------------------------------------------- |
| `notebookId` | —       | Required notebook to run                                                    |
| `inputs`     | `[]`    | Optional input definitions; empty means discover them from the notebook API |

Publishing the files is not enough for the embedded path. A project needs **API access for apps**
enabled, which is a separate opt-in from app sharing. Without it the page answers the handshake
with nothing at all, and the app reports that it could not acquire a token.

## Local preview

```bash
pnpm example:cloud-app
```

Open the printed URL. This serves the page only: nothing embeds it, so the app renders its layout and
then reports that it has no token. Publish it to exercise notebook loading and runs.

## Publishing to deepnote.com

```bash
# 1. Set notebookId in APP_CONFIG inside index.html
# 2. Publish with a personal API token and enable the app's Deepnote API access
DEEPNOTE_TOKEN=... deepnote publish examples/local-runner/cloud-app --project-id <your-project-id> --api-access enabled
```

The command enables app sharing and prints the canonical URL. At that URL, the app acquires a viewer
token automatically via `postMessage` — no server or manual token configuration.
