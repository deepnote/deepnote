# Deepnote + Streamlit

Two Streamlit apps built on the same `.deepnote` files as the
[TypeScript and JavaScript examples](../local-runner):

| Example                              | Reads                                   | Runs the notebook                   | Command                         |
| ------------------------------------ | --------------------------------------- | ----------------------------------- | ------------------------------- |
| [`static_app.py`](./static_app.py)   | A saved snapshot (`.snapshot.deepnote`) | No                                  | `pnpm example:streamlit:static` |
| [`dynamic_app.py`](./dynamic_app.py) | A local `.deepnote` file                | In Deepnote Cloud or a local kernel | See [Dynamic app](#dynamic-app) |

Both apps use [Deepnote Toolkit](https://github.com/deepnote/deepnote-toolkit). Its
`deepnote_toolkit.notebooks` package reads `.deepnote` files, runs notebooks and decodes their
outputs, such as dataframes, images and text. Its `deepnote_toolkit.streamlit` package adds
Streamlit widgets for notebook inputs and a runner for apps hosted in Deepnote. Each app keeps its
own layout and logic. A new app is an ordinary Streamlit file, whether you or a coding agent writes
it.

The `pnpm` commands run Python through
[uv](https://docs.astral.sh/uv/getting-started/installation/) 0.12 or later. Earlier uv versions
cannot install Deepnote Toolkit 2.8.0, because it depends on a pre-release package.

## Static app

```bash
pnpm example:streamlit:static
```

The app reads [`snapshot-showcase.snapshot.deepnote`](../snapshot-showcase.snapshot.deepnote) and
shows its saved outputs. It needs no API token, kernel, runner process or network access.

## Dynamic app

The dynamic app shows the notebook's inputs as Streamlit widgets and runs the notebook with the
values you choose. The app can run in three ways:

- [Hosted in Deepnote](#publish-the-app-in-deepnote), where the notebook runs as the current
  viewer.
- [Locally with an API token](#run-locally-with-an-api-token), against a notebook in Deepnote Cloud.
- [Locally through a runner process](#run-locally-through-a-runner-process), in Deepnote Cloud or
  in a local kernel.

### Deploy the notebook

The app builds its input widgets from the local `.deepnote` file and sends the values, by variable
name, to the cloud notebook. Both must have the same inputs.

If the notebook is not in Deepnote yet, import the file:

```bash
deepnote open examples/local-runner-showcase.deepnote
```

The command imports the file into a new project and opens it in your browser.
`DEEPNOTE_NOTEBOOK_ID` is the ID of the cloud notebook: the part of the notebook's URL after
`/notebook/`.

After every change to the local file, push it to the cloud notebook:

```bash
export DEEPNOTE_NOTEBOOK_ID=...
export DEEPNOTE_TOKEN=...

deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --dry-run
deepnote run examples/local-runner-showcase.deepnote \
  --cloud --notebook-id "$DEEPNOTE_NOTEBOOK_ID" --push --yes
```

`DEEPNOTE_TOKEN` is a Deepnote API token. To create one, see
[Authentication](../../docs/deepnote-cli-publish.md#authentication).

The first command previews the changes. The second applies them and runs the notebook once.
Pushing can delete and recreate blocks, so the app never pushes by itself.

### Publish the app in Deepnote

A hosted app does not see your shell's environment variables. Before you upload the app files, set
the default for `NOTEBOOK_ID` in `dynamic_app.py` to the cloud notebook's ID:
`os.environ.get("DEEPNOTE_NOTEBOOK_ID", "your-notebook-id")`. The environment variable still
overrides it for local runs.

`deepnote streamlit publish` does not upload files. The entrypoint and every local module it
imports must already be in the project's Files. Upload them in Deepnote. In a sync workspace,
`deepnote sync --all-files` can upload them together with a pending notebook push. A change to a
`.py` file alone does not trigger a sync. For this example, the project needs these files at these
paths:

- `examples/streamlit/dynamic_app.py`
- `examples/streamlit/_sales_dashboard.py`
- `examples/local-runner-showcase.deepnote`

Then publish the entrypoint with the CLI and your API token, as for other cloud commands:

```bash
deepnote streamlit publish examples/streamlit/dynamic_app.py --project-id <project-uuid>
```

The path is relative to the project, not to your machine. A 404 means the file is not in the
project yet. Creating the app restarts the project machine, which takes a few minutes and
interrupts anyone working in the project. The command prints the app URL and waits up to 10
minutes for the app to report `running`. Use `--no-wait` to skip the wait. Publishing a file that
already has an app reports that app and does not restart the machine.

Deleting the entrypoint can remove its app. `deepnote sync` replaces a changed file by deleting it
and uploading it again, so after you sync an edited entrypoint, publish it again and use the URL the
command returns. The URL may change.

### How the hosted app runs the notebook

When Deepnote hosts the app, it starts Streamlit on the published entrypoint. For each viewer,
`StreamlitCloudRunner` gets a short-lived API token for that viewer and calls the public API with
it, as the CLI does with your API token. The token is reused within one Streamlit session until
shortly before it expires and is never shared between sessions. `StreamlitCloudRunner` never sends
the Streamlit cookie to the public API and never falls back to the project owner's credentials.

Hosted runs work only when all of these are true:

- The project owner has turned on Streamlit app API access. To turn it on, open the entrypoint
  file in the project, click **Settings** above the app preview, and turn on **Allow API access
  for all Streamlit apps in this project**.
- The viewer is signed in and has direct access to the project.
- If the notebook has agent blocks, the viewer can edit the notebook. Deepnote runs agent blocks
  only for people who can edit the notebook. This example ends with an agent block, so a viewer
  with view access gets "You do not have permission to edit this notebook".

The token can reach notebooks only in the project that hosts the app. Anonymous visitors and
people who only have a share link can open the app but cannot get a viewer token. For them, the app
shows an error and disables the run button. If the app is meant for that audience, render a saved
snapshot, as `static_app.py` does, or ask viewers to sign in.

The app also disables the run button when the notebook's inputs do not match the local file. It
reads the notebook's inputs once per session, so reload the page after you push a change. Runs
use read-only project storage by default, so the notebook cannot change the project's files. Pass
`storage_mode="read_write"` to `StreamlitCloudRunner` to allow writes.

### Run locally with an API token

To develop against a notebook in Deepnote Cloud, use the same API token as the CLI:

```bash
DEEPNOTE_NOTEBOOK_ID=... DEEPNOTE_TOKEN=... pnpm example:streamlit:dynamic
```

Outside Deepnote, `StreamlitCloudRunner` uses a token only when you pass `local=True` together with
`token=` or `token_provider=`. The example does this with `DEEPNOTE_TOKEN`. In a hosted app,
`StreamlitCloudRunner` ignores `local=True` and any token you pass, and always runs as the viewer.

Do not export `DEEPNOTE_PROJECT_ID` in the shell that runs the app. `StreamlitCloudRunner` treats
it as a sign that the app is hosted and then asks for a viewer token, which a local process cannot
get.

### Run locally through a runner process

The runner process (`pnpm example:streamlit:runner`) runs the notebook for the app, in Deepnote
Cloud or in a local kernel. Start it and the app in separate terminals:

```bash
# Terminal 1: run in Deepnote Cloud (the default)
DEEPNOTE_TOKEN=... pnpm example:streamlit:runner

# Terminal 2: point the app at the runner process
DEEPNOTE_RUNNER_URL=http://127.0.0.1:8787 pnpm example:streamlit:dynamic
```

To use a local kernel instead, change only the first command:

```bash
RUN_TARGET=local OPENAI_API_KEY=... pnpm example:streamlit:runner
```

The runner process can create the cloud notebook if it does not exist yet. To update an existing
notebook, use the push step in [Deploy the notebook](#deploy-the-notebook).

A local kernel needs the same Python environment as `deepnote run`, including
`deepnote-toolkit[server]`, and `matplotlib` for the notebook's chart. Set
`DEEPNOTE_PYTHON_ENV=/path/to/venv` if that environment is not your default Python. Only the
notebook's final agent block needs `OPENAI_API_KEY` in a local kernel. The other blocks need no API
keys.

If port 8787 is taken, set `DEEPNOTE_RUNNER_PORT` for the runner process and the matching
`DEEPNOTE_RUNNER_URL` for the app.

## Build your own app

To build a new app, make three choices:

1. Point `DeepnoteDocument.load(...)` at a local `.deepnote` file or a snapshot.
2. For a dynamic app, show `document.inputs` with `render_inputs(...)` and pass the returned values
   to `StreamlitCloudRunner.run(...)` or `DeepnoteLocalRunner.run(...)`.
3. Read the outputs with `first_dataframe()`, `images()` and `agent_text()`, and present them with
   ordinary Streamlit code.

The app does not need to know how Deepnote stores inputs, how nbformat encodes text and images,
or whether the notebook runs in Deepnote Cloud or in a local kernel. These helpers ship with
Deepnote Toolkit 2.8.0 and later, so `deepnote-toolkit[server]` is the only package the app needs.

## Tests

Run the smoke tests:

```bash
pnpm test:streamlit
```
