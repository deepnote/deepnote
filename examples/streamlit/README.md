# Deepnote + Streamlit

Two custom Streamlit apps over the same `.deepnote` artifacts as the TypeScript/JavaScript
examples:

| Example                              | Source                           | Execution                  | Command                         |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------------- |
| [`static_app.py`](./static_app.py)   | A committed `.snapshot.deepnote` | None                       | `pnpm example:streamlit:static` |
| [`dynamic_app.py`](./dynamic_app.py) | A local source `.deepnote`       | Cloud by default, or local | See below                       |

Both use [`deepnote-toolkit`](https://github.com/deepnote/deepnote-toolkit). Its
`deepnote_toolkit.streamlit` module owns the repetitive parts—input metadata, widgets, HTTP
requests, dataframe/image/text decoding—while each app owns its layout and product logic. That is
the intended agent contract: generate an ordinary Streamlit file, not a second notebook renderer.

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
export DEEPNOTE_PROJECT_ID=...
export DEEPNOTE_TOKEN=...

deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --dry-run
deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --yes
```

The first command previews the block changes. The second applies them and performs one deployment
run. Synchronization is intentionally not part of a Streamlit viewer request because it may delete
or recreate blocks.

After the Streamlit source file exists in the project's Files, publish it through the same CLI and
API-key authentication used for other cloud operations:

```bash
deepnote publish examples/streamlit/dynamic_app.py \
  --project-id "$DEEPNOTE_PROJECT_ID" \
  --streamlit
```

The positional path is project-relative, not a local upload. Upload or sync the file into the
project first. For this example, the project must contain `examples/streamlit/dynamic_app.py`,
`examples/streamlit/_sales_dashboard.py`, and `examples/local-runner-showcase.deepnote` at those
paths. The command calls `POST /v2/streamlit-apps` and prints the hosted app URL.

In a hosted Deepnote app, start only Streamlit for normal app runs:

```bash
pnpm example:streamlit:dynamic
```

The app parses its local `.deepnote` file for the UI contract and sends input values to the public
runs API. For each API request, `DeepnoteCloudRunner` uses the hosted Streamlit session to obtain a
short-lived API token scoped to the current viewer, matching the CLI and public API authentication
model. It does not send the Streamlit cookie to the public API, cache either credential in
process-global or Streamlit session state, or fall back to a shared project-owner credential. The
app disables the run button if the deployed notebook's input names or types differ from the local
file.

For local development against an existing cloud notebook, supply the same API token used by the
CLI:

```bash
DEEPNOTE_NOTEBOOK_ID=... DEEPNOTE_TOKEN=... pnpm example:streamlit:dynamic
```

Application code may also pass an explicit `token=` or `token_provider=` to
`DeepnoteCloudRunner`. The default provider remains preferable in hosted apps because it is scoped
to the current viewer and is re-evaluated for each request.

For sidecar-based local development, start the runner and Streamlit in separate terminals. The
sidecar can create a missing cloud notebook, but updates to an existing one still use the explicit
deployment sync above:

```bash
# Terminal 1: cloud execution (default)
DEEPNOTE_TOKEN=... pnpm example:streamlit:runner

# Terminal 2: select the sidecar explicitly
DEEPNOTE_RUNNER_URL=http://127.0.0.1:8787 pnpm example:streamlit:dynamic
```

For a local kernel, only the runner setting changes:

```bash
RUN_TARGET=local OPENAI_API_KEY=... pnpm example:streamlit:runner
```

With a sidecar, the app calls `POST /api/run` and parses the same response. Local execution requires
the same Python environment as `deepnote run`, including `deepnote-toolkit[server]`. The example
notebook's dashboard is deterministic; its final agent block alone needs `OPENAI_API_KEY` locally.
Set `DEEPNOTE_PYTHON_ENV=/path/to/venv` when that environment is not the default Python.

Override `DEEPNOTE_RUNNER_PORT` on the sidecar and set the matching `DEEPNOTE_RUNNER_URL` for
Streamlit when port 8787 is unavailable.

## The copyable pattern

An agent creating a new app needs three decisions:

1. Point `DeepnoteDocument.load(...)` at the local source or snapshot.
2. For a dynamic app, render `document.inputs` and send the returned values to either
   `DeepnoteCloudRunner.run(...)` or `DeepnoteRunner.run(...)`.
3. Query outputs by meaning (`first_dataframe()`, `images()`, `agent_text()`) and write normal
   Streamlit presentation code.

The generated app does not need to know how Deepnote inputs are stored, how nbformat represents
text and images, or whether the runner talks to deepnote.com or starts a local kernel. The Python
helpers ship as part of Deepnote Toolkit, so no separate package or PyPI release is required.

Run the cross-repository example smoke tests after a compatible Toolkit release is available:

```bash
pnpm test:streamlit
```
