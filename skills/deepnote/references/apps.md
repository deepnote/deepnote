# Build and publish a Deepnote app

Use this guide to choose an app type, prepare its files, and verify it in the environment where
viewers will use it. Use **app** as the general term, qualified as **data app**, **Streamlit app**,
**static app**, or **local app** when the runtime matters. A static app can call the Deepnote API;
“static” means Deepnote hosts its browser files without a custom server.

## Choose an app type

Keep the user's chosen framework and hosting target. If neither is specified, choose by the work
the app needs to do:

| Need                                                                | Choose        | Prepare                                                                  |
| ------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Present notebook blocks with inputs and outputs                     | Data app      | A notebook; configure and publish the app in the Deepnote UI             |
| Run a Python UI with custom widgets                                 | Streamlit app | A `.py` entrypoint and its dependencies in the project's Files           |
| Build a custom HTML/JS interface hosted by Deepnote                 | Static app    | A browser build directory; enable viewer API access if it runs notebooks |
| Use local Python, scheduling, or run history through a local server | Local app     | A browser build, a `.deepnote` file, and a `serveStatic` server          |

Data and Streamlit apps run on project hardware. Static apps run in the browser; their notebook
runs use project hardware. Local apps run on the operator's machine and can send notebook runs to
Deepnote.

For an audience without Deepnote accounts, consider a data app's public or link-sharing options.
Static app viewers must sign in and have project access.

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

Creating an app restarts the project machine and interrupts active work. Replacing the entrypoint
through file sync can remove its app registration; publish again and use the returned URL, which
may change. Some apps created in the UI retain their registration.

For ordinary Python integration access, use the project's integrations. Federated-auth integrations
require each viewer to authenticate; see [Streamlit apps](https://deepnote.com/docs/streamlit).

For public API calls as the viewer, the project owner must enable Streamlit app API access, and
the viewer must be signed in with direct project access. This token can access notebooks only in
the hosting project. Handle missing viewer
credentials with a sign-in/access hint or saved results instead of offering a run that will fail.
Do not substitute the publisher's personal token.

## Prepare a static app

1. Build the HTML, CSS, JavaScript, and assets into a dedicated output directory such as `dist`.
   Exclude credentials and files that viewers should not receive.
2. Use browser-compatible code. A published static app has no local `serveStatic` routes or Python
   server. If it runs notebooks, implement the viewer API flow below.
3. Follow [Publish a static app](cli-publish.md#publish-a-static-app).
4. Open the returned URL as a viewer with project access. Check assets, navigation, and any notebook
   runs in that hosted page.

Use the URL returned by Deepnote. `/` serves `index.html`; a path ending in `/` serves that
directory's `index.html`. Other paths serve exact filenames, so link to `about.html`, not `/about`.

### Add viewer API access

Enable API access only when the app needs notebook inputs or runs. Use the token handshake in
[cloud app example](https://github.com/deepnote/deepnote/tree/main/examples/local-runner/cloud-app): request a token from the Deepnote shell over `postMessage`, pin
the shell origin when sending and receiving messages, and send API requests to the returned API
origin. Keep personal development tokens out of the published build.

A static app's viewer token can access notebooks in the hosting project and other projects in the
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

## Prepare a local app

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

Publishing this build as a static app does not deploy the local server. Replace local API calls
with the viewer API flow before publishing it to Deepnote.

## Choose the available tool

- With a terminal, use the CLI publishing workflow linked above.
- With only hosted MCP (`https://deepnote.com/mcp`), inspect its advertised tools. Use
  `publish_static_site` if available to publish a static app, and `update_project` to change sharing
  or viewer API access. Do not use notebook execution to write app files. Hosted MCP can activate
  an existing Streamlit entrypoint but cannot upload it; arrange the file upload first.
- Use local `@deepnote/mcp` for local `.deepnote` file work. It does not manage hosted apps or
  publish files.
