# local-runner demo (spike)

A single `index.html` that runs [`../6_with_inputs.deepnote`](../6_with_inputs.deepnote)
locally: edit the inputs, click **Run**, and real Python output comes back — powered entirely
by [`@deepnote/local-runner`](../../packages/local-runner)'s `serveStatic`.

This is a **spike / demo, not intended for merge**. It exists to show how little code a static
site needs to drive local notebook execution:

- **[`serve.mjs`](./serve.mjs)** — ~10 lines: `serveStatic({ dir, notebookPath })`.
- **[`index.html`](./index.html)** — one file: `GET /api/info` to build the input controls,
  `POST /api/run` to execute and render outputs. No framework, no build step.

## Run it

Requires a Python environment with `deepnote-toolkit[server]` (the same prerequisite as
`deepnote run`).

```bash
# from the repo root — build the package (and its workspace deps)
pnpm --filter @deepnote/local-runner... build

node examples/local-runner-demo/serve.mjs
# open the printed http://127.0.0.1:<port>
```

Edit "Greeting", drag "Count", toggle "Enabled", hit **Run locally** — the output echoes your
inputs (`greeting = …`, `count = …`, `enabled = True/False`), executed for real in a local kernel.

## The second way: Run in cloud

The page also has a **☁ Run in cloud** button, wired to `POST /api/run-cloud` →
`runInCloud` → the shared `@deepnote/cloud` client (the same one behind `deepnote run --cloud`).
It runs the notebook in Deepnote Cloud and renders the returned snapshot's outputs.

Needs a `DEEPNOTE_TOKEN`:

```bash
DEEPNOTE_TOKEN=... node examples/local-runner-demo/serve.mjs
```

If the notebook **already exists** in your Deepnote workspace, it runs there and the outputs come
back. If it **doesn't exist yet**, `runInCloud` uploads it ("Open in Deepnote") and the button opens
the returned import URL in a new tab — finish the import in Deepnote, then hit Run in cloud again.
Without a token it degrades gracefully (the status line says what's missing).
