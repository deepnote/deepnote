# Build and publish data apps and Streamlit apps

Use **data app** for an HTML, CSS, and JavaScript page hosted by a data app project, and **Streamlit
app** for a Python UI. A data app can be interactive and run notebooks through the Deepnote API. Follow the matching
workflow to prepare files, publish, and verify the result as its intended viewer.

## Choose a workflow

Keep the user's chosen framework and hosting target. If neither is specified, choose by the work
needed:

| Need                                                                | Choose        | Prepare                                                         |
| ------------------------------------------------------------------- | ------------- | --------------------------------------------------------------- |
| Build a custom HTML/JS interface hosted by Deepnote                 | Data app      | A data app project and a browser build directory                |
| Run a Python UI with custom widgets                                 | Streamlit app | A `.py` entrypoint and its dependencies in the project's Files  |
| Use local Python, scheduling, or run history through a local server | Local server  | A browser build, a `.deepnote` file, and a `serveStatic` server |

Data apps run in the browser; their notebook runs use project hardware. Streamlit apps run on
project hardware. A local server runs on the operator's machine and can send notebook runs
to Deepnote.

Data app viewers must sign in and have project access; data apps have no public or link-only sharing.
Streamlit apps follow the project's sharing settings, but only signed-in viewers with project access can
use their viewer API access. Apps published from notebook blocks are deprecated; do not build new ones.

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

Creating a Streamlit app restarts the project machine and interrupts active work. Sync overwrites a
changed entrypoint in place, so it keeps its app and URL. Deleting and re-uploading an entrypoint can
remove its app registration instead; publish again after that and use the new URL. Some Streamlit apps
created in the UI retain their registration.

For ordinary Python integration access, use the project's integrations. Federated-auth integrations
require each viewer to authenticate; see [Streamlit apps](https://deepnote.com/docs/streamlit).

For public API calls as the viewer, the project owner must enable Streamlit app API access, and
the viewer must be signed in with direct project access. This token can access notebooks only in
the hosting project. Handle missing viewer credentials with a sign-in/access hint or saved results
instead of offering a run that will fail.
Do not substitute the publisher's personal token.

## Prepare a data app

1. Use a data app project. Publishing refuses any other project type, and a `.deepnote` file cannot
   create one. Create it on the first publish with `deepnote publish <dir> --create <name>`, or have
   the user create it in Deepnote with **Create new → New data app**. Data app projects are in beta
   and may not be enabled for the workspace yet.
2. Build the HTML, CSS, JavaScript, and assets into a dedicated output directory such as `dist`.
   Exclude credentials and files that viewers should not receive.
3. Use browser-compatible code. A published app has no local `serveStatic` routes or Python
   server. If it runs notebooks, implement the viewer API flow below.
4. Follow [Publish a data app](cli-publish.md#publish-a-data-app).
5. Open the returned URL as a viewer with project access. Check assets, navigation, and any notebook
   runs in that hosted page.

Use the URL returned by Deepnote. `/` serves `index.html`; a path ending in `/` serves that
directory's `index.html`. Other paths serve exact filenames, so link to `about.html`, not `/about`.

### Add viewer API access

A published data app always has viewer API access. When it needs notebook inputs or runs, use the token handshake in
[cloud app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/cloud-app): request a token from the Deepnote shell over `postMessage`, pin
the shell origin when sending and receiving messages, and send API requests to the returned API
origin. Keep personal development tokens out of the published build.

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

Refresh the token through the handshake before its 15-minute expiry and retry authentication on a 401. Verify the hosted flow: a successful local preview with a personal token does not test viewer
permissions or token refresh.

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

Publishing this build as a data app does not deploy the local server. Replace local API calls
with the viewer API flow before publishing it to Deepnote.

## Choose the available tool

- With a terminal, use the CLI publishing workflow linked above.
- With only hosted MCP (`https://deepnote.com/mcp`), inspect its advertised tools. Use
  `write_file` to write a data app's files below `_deepnote_static/`, then `update_project` to publish
  or unpublish it. Set `overwrite` when replacing an existing file, and check the returned path:
  without it, Deepnote writes a uniquely named copy and the app keeps serving the old file. Do not use notebook execution to write app files. Hosted MCP can also write a
  Streamlit entrypoint with `write_file` and serve it with `create_streamlit_app`.
- Use local `@deepnote/mcp` for local `.deepnote` file work. It does not manage hosted apps or
  publish files.
