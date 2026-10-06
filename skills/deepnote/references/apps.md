# Build and publish apps and Streamlit apps

Use **app** for HTML, CSS, and JavaScript hosted by Deepnote, and **Streamlit app** for a Python
UI. An app can be interactive and run notebooks through the Deepnote API. Follow the matching
workflow to prepare files, publish, and verify the result as its intended viewer.

## Choose a workflow

Keep the user's chosen framework and hosting target. If neither is specified, choose by the work
needed:

| Need                                                                | Choose        | Prepare                                                                  |
| ------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Build a custom HTML/JS interface hosted by Deepnote                 | App           | A browser build directory; enable viewer API access if it runs notebooks |
| Run a Python UI with custom widgets                                 | Streamlit app | A `.py` entrypoint and its dependencies in the project's Files           |
| Present notebook blocks with inputs and outputs                     | Data app      | A notebook; configure and publish the data app in the Deepnote UI        |
| Use local Python, scheduling, or run history through a local server | Local server  | A browser build, a `.deepnote` file, and a `serveStatic` server          |

Apps run in the browser; their notebook runs use project hardware. Streamlit apps and data apps
run on project hardware. A local server runs on the operator's machine and can send notebook runs
to Deepnote.

For an audience without Deepnote accounts, consider a data app's public or link-sharing options.
App viewers must sign in and have project access.

## Prepare a data app

1. Create or edit the notebook's blocks, inputs, and outputs. Order the blocks for the intended UI.
2. Run the notebook and check its outputs.
3. Configure the visible blocks and app permissions in the Deepnote UI. File edits alone cannot
   create the app or set its permissions.

Viewers change inputs and run the notebook on project hardware, with separate state per viewer.
See [Data apps](https://deepnote.com/docs/data-apps) for sharing and layout settings.

## Prepare a Streamlit app

1. Write the `.py` entrypoint and install its dependencies in the project environment. The app
   inherits the project's integrations and sharing settings and sleeps when its hardware is inactive.
2. If the app runs a notebook, deploy that notebook before publishing. Keep the local `.deepnote`
   file's block IDs aligned with the deployed notebook; preview with
   `deepnote run <file> --cloud --push --dry-run`, then apply the intended changes with
   `deepnote run <file> --cloud --push --yes`.
3. Upload the entrypoint and local dependencies into the project's Files in Deepnote. If a notebook
   push is already pending in a sync workspace, `deepnote sync --all-files` can upload the files
   with it. For a `.py`-only edit, use the Deepnote upload flow; the edit alone does not trigger sync.
4. Follow [Publish a Streamlit app](cli-publish.md#publish-a-streamlit-app), then open the returned
   URL and test the app as its intended viewer.

Creating a Streamlit app restarts the project machine and interrupts active work. Replacing the
entrypoint through file sync can remove its app registration; publish again and use the returned
URL, which may change. Some Streamlit apps created in the UI retain their registration.

For ordinary Python integration access, use the project's integrations. Federated-auth integrations
require each viewer to authenticate; see [Streamlit apps](https://deepnote.com/docs/streamlit).

For public API calls as the viewer, the project owner must enable Streamlit app API access, and
the viewer must be signed in with direct project access. This token can access notebooks only in
the hosting project. Handle missing viewer credentials with a sign-in/access hint or saved results
instead of offering a run that will fail.
Do not substitute the publisher's personal token.

## Prepare an app

1. Build the HTML, CSS, JavaScript, and assets into a dedicated output directory such as `dist`.
   Exclude credentials and files that viewers should not receive.
2. Use browser-compatible code. A published app has no local `serveStatic` routes or Python
   server. If it runs notebooks, implement the viewer API flow below.
3. Follow [Publish an app](cli-publish.md#publish-an-app).
4. Open the returned URL as a viewer with project access. Check assets, navigation, and any notebook
   runs in that hosted page.

Use the URL returned by Deepnote. `/` serves `index.html`; a path ending in `/` serves that
directory's `index.html`. Other paths serve exact filenames, so link to `about.html`, not `/about`.

### Add viewer API access

Enable API access only when the app needs notebook inputs or runs. Load Deepnote's browser client
from the origin of the app's URL, for example `https://deepnote.com/static/app-client/v1.js`,
before the app's own scripts. Its `window.Deepnote.connect()` requests the viewer's token from the
Deepnote shell, renews it, and starts runs with read-only project storage:

```js
const notebook = window.Deepnote.connect({
  onAuthExpired: showReloadMessage,
}).notebook(notebookId);
const inputs = await notebook.inputs();
const { run, result } = await notebook.run(values, {
  onProgress: (_, phase) => showProgress(phase),
});
const payload = run.status === "success" ? result("sales-by-region/v1") : null;
```

Key `values` by input name. `run()` resolves with any final status, so check `run.status` and
`run.error`. `result(schema)` returns the first `application/json` output whose `schema` field
matches, or `null`. If the shell sends no token within 8 seconds, the call rejects,
`onAuthExpired` runs, and later calls reject until the page reloads; show a message pointing to
the app's Deepnote URL.

Without the client, use the token handshake in
[cloud app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/cloud-app): request a token from the Deepnote shell over `postMessage`, pin
the shell origin when sending and receiving messages, send API requests to the returned API
origin, refresh the token through the handshake before its 15-minute expiry and on a 401, and send
`detachedRunStorageMode: "readonly"` with each run. Keep personal development tokens out of the
published build.

An app's viewer token can access notebooks in the hosting project and other projects in the
same workspace where the viewer has direct access; starting runs in other projects also requires
execute permission. Supply notebook IDs explicitly; the token cannot list notebooks. Design the UI
around its supported operations:

- Read notebook inputs and block metadata, without source content.
- Start a detached run and poll that viewer's own run by ID.
- Render the returned `snapshotBlocks`; raw snapshot YAML and download URLs are unavailable.

Do not offer notebook enumeration, run history, or access to another viewer's runs in the embedded
app. Other endpoints return 403. If a local preview has these features, hide them when `isEmbedded`
is true and surface unexpected API errors.

Verify the hosted flow: a successful local preview with a personal token does not test viewer
permissions or token refresh.

### Return notebook results to an app

Have one notebook block display exactly what the app renders as JSON, under a schema name the app
passes to `result()`:

```python
import json
from IPython.display import display

rows = json.loads(df.to_json(orient='records', date_format='iso'))
display({'application/json': {'schema': 'sales-by-region/v1', 'rows': rows}}, raw=True)
```

`to_json` writes missing values as `null` and dates as ISO strings. `df.to_dict('records')` does
not: a missing number reaches the app as the string `"nan"`, and a missing timestamp fails the
block. Send integers past 2^53 as strings, because `JSON.parse` rounds them. Aggregate in the
notebook: Deepnote replaces a block's outputs with a short notice when they pass 512 KiB as JSON,
or when the notebook's outputs together pass 5 MiB.

Reading a dataframe output (`application/vnd.deepnote.dataframe.v3+json`) instead gives one page of
`rows`, 10 unless the block's [`deepnote_table_state`](blocks-code-and-sql.md) sets a larger
`pageSize`, while `row_count` is the total. For pandas frames, its values do not follow the column
types:

- Missing values are the strings `nan`, `None`, `NaT`, or `<NA>`, also inside numeric columns.
- Booleans and nullable integers are strings, such as `"True"` and `"1.0"`. Timestamps are strings
  such as `"2024-01-01 00:00:00"`.
- When a value on the page is past 2^53 or infinite, the whole column is strings on that page. In
  an integer column, keep those strings or use `BigInt`; `Number()` rounds them.
- Every row has `_deepnote_index_column`, the frame's index, which is not counted in
  `column_count`.

Polars and Spark frames send missing values as `null` and numbers as JSON numbers.

## Run a local server

Use `serveStatic` from `@deepnote/local-runner` to serve the build and a notebook from `127.0.0.1`:

```ts
const { port, close } = await serveStatic({
  dir,
  notebookPath,
  runTarget: "cloud",
});
```

Choose `runTarget: "cloud"` (the default) to run in Deepnote using `DEEPNOTE_TOKEN`, or `"local"`
to use a local Python environment with `deepnote-toolkit[server]`. Cloud mode creates the notebook
if it does not exist; local mode writes snapshots beside the notebook and returns no cloud run ID.

Build controls from `GET /api/info`, submit inputs to `POST /api/run`, and render outputs in the
page. Use the `@deepnote/local-runner/snapshot-reader` browser bundle to read snapshot YAML.
For cloud scheduling and run history routes, consult the
[local-runner API](https://github.com/deepnote/deepnote/tree/main/packages/local-runner#readme) and
[run app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/run-app).

Publishing this build as an app does not deploy the local server. Replace local API calls
with the viewer API flow before publishing it to Deepnote.

## Choose the available tool

- With a terminal, use the CLI publishing workflow linked above.
- With only hosted MCP (`https://deepnote.com/mcp`), inspect its advertised tools. Use
  `publish_static_site` if available to publish an app, and `update_project` to change sharing
  or viewer API access. Do not use notebook execution to write app files. Hosted MCP can activate
  an existing Streamlit entrypoint but cannot upload it; arrange the file upload first.
- Use local `@deepnote/mcp` for local `.deepnote` file work. It does not manage hosted apps or
  publish files.
