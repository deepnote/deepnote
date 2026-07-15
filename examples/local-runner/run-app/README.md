# run-app

A page that runs [`../../local-runner-showcase.deepnote`](../../local-runner-showcase.deepnote)
locally: edit the inputs, click **Run**, and real Python output — a KPI, a table, a chart — comes
back, powered entirely by [`@deepnote/local-runner`](../../../packages/local-runner)'s `serveStatic`.

It's an app shell, not a document: an inputs panel on the left, a results canvas on the right. Two
files do the work — [`serve.mjs`](./serve.mjs) (`serveStatic({ dir, notebookPath })`) and
[`index.html`](./index.html) (`GET /api/info` to build the controls, `POST /api/run` to execute and
render). No framework, no build step.

## Run it

Requires a Python environment with `deepnote-toolkit[server]` — the same prerequisite as
`deepnote run`.

```bash
pnpm example:local-runner
# open the printed http://127.0.0.1:<port>
```

That builds the package and starts the server. Edit the inputs and hit **Run** — the notebook
executes in a local kernel and the dashboard updates.

## Run in Deepnote Cloud

The page also has a **Run in cloud** button, wired to `POST /api/run-cloud` → `runInCloud` → the
shared `@deepnote/cloud` client (the same one behind `deepnote run --cloud`). It runs the notebook in
Deepnote Cloud and renders the returned snapshot.

It needs a `DEEPNOTE_TOKEN`:

```bash
DEEPNOTE_TOKEN=... pnpm example:local-runner
```

If the notebook already exists in your Deepnote workspace, it runs there and the outputs come back
(with a "view in Deepnote" link). If it doesn't exist yet, `runInCloud` uploads it ("Open in
Deepnote") and the button opens the import URL in a new tab — finish the import in Deepnote, then hit
**Run in cloud** again. Without a token the button degrades gracefully and the status line says
what's missing.

## Notes

- HTML outputs (the KPI cards, the table) render in a `sandbox`ed iframe with a **null origin**, so a
  notebook's output can never touch this page. `allow-scripts` is used only to let the frame report
  its height for a clean fit.
- Input values are coerced to each block's schema shape before running — a slider yields `7`, the
  kernel and snapshot see `'7'` — so native control values just work.
