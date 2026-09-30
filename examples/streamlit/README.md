# Deepnote + Streamlit

Two custom Streamlit apps over the same `.deepnote` artifacts as the TypeScript/JavaScript
examples:

| Example                              | Source                           | Execution                  | Command                         |
| ------------------------------------ | -------------------------------- | -------------------------- | ------------------------------- |
| [`static_app.py`](./static_app.py)   | A committed `.snapshot.deepnote` | None                       | `pnpm example:streamlit:static` |
| [`dynamic_app.py`](./dynamic_app.py) | A local source `.deepnote`       | Cloud by default, or local | See below                       |

Both use [`deepnote-toolkit`](https://github.com/deepnote/deepnote-toolkit). Its
`deepnote_toolkit.notebooks` package owns the repetitive parts that need no Streamlit—input
metadata, HTTP requests, dataframe/image/text decoding—and `deepnote_toolkit.streamlit` adds the
widgets and the hosted runner, while each app owns its layout and product logic. That is the
intended agent contract: generate an ordinary Streamlit file, not a second notebook renderer.

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
or recreate blocks. It is also what aligns the two sides: the app reads its local `.deepnote` file
for the UI contract and sends the cloud notebook input values by variable name, so the local file
must be pushed before the app is published and after every edit to it.

A hosted app does not inherit your shell's environment. Before pushing the app files, give
`NOTEBOOK_ID` in `dynamic_app.py` the cloud notebook's id as a default,
`os.environ.get("DEEPNOTE_NOTEBOOK_ID", "your-notebook-id")`, which keeps the variable working for
local runs.

Push first, then publish. `deepnote streamlit publish` uploads nothing: the entrypoint and every
local module it imports must already be in the project's Files. Upload them in Deepnote. If a
notebook push is already pending in a sync workspace, `deepnote sync --all-files` can upload them
with it; a `.py`-only edit does not trigger sync. Then register the entrypoint through the same CLI
and API-key authentication used for other cloud operations:

```bash
deepnote streamlit publish examples/streamlit/dynamic_app.py --project-id <project-uuid>
```

The positional path is project-relative, not a local upload. For this example, the project must
contain `examples/streamlit/dynamic_app.py`, `examples/streamlit/_sales_dashboard.py`, and
`examples/local-runner-showcase.deepnote` at those paths; a 404 for the entrypoint means the file
is not there yet. Creating the app restarts the project machine, which takes a few minutes and
interrupts anyone working in the project. The command prints the hosted app URL, then waits up to
10 minutes for the app to report `running` (`--no-wait` skips the wait). Publishing a file that is
already served reports the existing app without restarting the machine.

Deleting the entrypoint can remove its app registration. Sync replaces a changed file by deleting it
and uploading it again, so after syncing an edited entrypoint, publish again and use the returned
URL, which may change.

When Deepnote hosts the app, it starts Streamlit on the published entrypoint itself. The app parses
its local `.deepnote` file for the UI contract and sends input values to the public runs API.
`StreamlitCloudRunner` uses the hosted Streamlit session to obtain a short-lived API token scoped
to the current viewer, matching the CLI and public API authentication model. The token is
reused within the current Streamlit session until shortly before it expires, and never shared
between sessions. The runner does not send the Streamlit cookie to the public API or fall back to a
shared project-owner credential. The app disables the run button if the deployed notebook's input
names or types differ from the local file. Runs use read-only project storage by default, so the
notebook cannot change the project's files; pass `storage_mode=None` to allow writes.

API calls from a hosted app work only when the project owner has enabled Streamlit app API access,
and only for signed-in viewers with direct access to the project. The token can reach notebooks only
in the hosting project. Anonymous visitors and viewers who only have a share link can open the page
but cannot get an API token, so the app shows the error and disables the run button. An app meant
for that audience should render a committed snapshot, as `static_app.py` does, or explain that
signing in is required.

For local development against an existing cloud notebook, supply the same API token used by the
CLI:

```bash
DEEPNOTE_NOTEBOOK_ID=... DEEPNOTE_TOKEN=... pnpm example:streamlit:dynamic
```

Outside Deepnote, `StreamlitCloudRunner` uses a token only with `local=True` and an explicit
`token=` or `token_provider=`, which is why the example passes `DEEPNOTE_TOKEN` that way. A hosted
app ignores both and always uses the current viewer's token. Do not export `DEEPNOTE_PROJECT_ID` in
the shell that runs the app: the runner reads it as a sign of hosting and then asks for a viewer
token that a local process cannot get.

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
   `StreamlitCloudRunner.run(...)` or `DeepnoteLocalRunner.run(...)`.
3. Query outputs by meaning (`first_dataframe()`, `images()`, `agent_text()`) and write normal
   Streamlit presentation code.

The generated app does not need to know how Deepnote inputs are stored, how nbformat represents
text and images, or whether the runner talks to deepnote.com or starts a local kernel. The Python
helpers ship as part of Deepnote Toolkit, so no package beyond `deepnote-toolkit[server]` is
required.

Run the cross-repository example smoke tests after a compatible Toolkit release is available:

```bash
pnpm test:streamlit
```
