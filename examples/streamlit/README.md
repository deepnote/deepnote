# Deepnote + Streamlit

Two custom Streamlit apps over the same `.deepnote` artifacts as the TypeScript/JavaScript
examples:

| Example                              | Source                           | Execution                  | Command                         |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------------- |
| [`static_app.py`](./static_app.py)   | A committed `.snapshot.deepnote` | None                       | `pnpm example:streamlit:static` |
| [`dynamic_app.py`](./dynamic_app.py) | A local source `.deepnote`       | Cloud by default, or local | See below                       |

Both use [`deepnote-streamlit`](../../packages/streamlit). The helper library owns the repetitive
parts—input metadata, widgets, HTTP requests, dataframe/image/text decoding—while each app owns its
layout and product logic. That is the intended agent contract: generate an ordinary Streamlit file,
not a second notebook renderer.

## Static app

```bash
pnpm example:streamlit:static
```

This reads [`snapshot-showcase.snapshot.deepnote`](../snapshot-showcase.snapshot.deepnote) directly.
No token, kernel, Node sidecar, or network is involved.

## Dynamic app

First synchronize the local source into the cloud notebook as an explicit deployment operation:

```bash
export DEEPNOTE_NOTEBOOK_ID=...
export DEEPNOTE_TOKEN=...

deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --dry-run
deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --yes
```

The first command previews the block changes. The second applies them and performs one deployment
run. Synchronization is intentionally not part of a Streamlit viewer request because it may delete
or recreate blocks.

Once deployed, start only Streamlit for normal app runs:

```bash
pnpm example:streamlit:dynamic
```

The app parses its local `.deepnote` file for the UI contract and sends input values to the public
runs API. It disables the run button if the deployed notebook's input names or types differ from
the local file. Applications with renewable credentials can pass a token provider to
`DeepnoteCloudRunner` instead of setting `DEEPNOTE_TOKEN`.

For sidecar-based local development, start the runner and Streamlit in separate terminals. The
sidecar can create a missing cloud notebook, but updates to an existing one still use the explicit
deployment sync above:

```bash
# Terminal 1: cloud execution (default)
DEEPNOTE_TOKEN=... pnpm example:streamlit:runner

# Terminal 2
pnpm example:streamlit:dynamic
```

For a local kernel, only the runner setting changes:

```bash
RUN_TARGET=local OPENAI_API_KEY=... pnpm example:streamlit:runner
```

The app still calls `POST /api/run` and parses the same response. Local execution requires the same
Python environment as `deepnote run`, including `deepnote-toolkit[server]`. The example notebook's
dashboard is deterministic; its final agent block alone needs `OPENAI_API_KEY` locally.
Set `DEEPNOTE_PYTHON_ENV=/path/to/venv` when that environment is not the default Python.

Override `DEEPNOTE_RUNNER_PORT` on the sidecar and set the matching
`DEEPNOTE_RUNNER_URL=http://127.0.0.1:<port>` for Streamlit when port 8787 is unavailable.

## The copyable pattern

An agent creating a new app needs three decisions:

1. Point `DeepnoteDocument.load(...)` at the local source or snapshot.
2. For a dynamic app, render `document.inputs` and send the returned values to either
   `DeepnoteCloudRunner.run(...)` or `DeepnoteRunner.run(...)`.
3. Query outputs by meaning (`first_dataframe()`, `images()`, `agent_text()`) and write normal
   Streamlit presentation code.

The generated app does not need to know how Deepnote inputs are stored, how nbformat represents
text and images, or whether the runner talks to deepnote.com or starts a local kernel.
