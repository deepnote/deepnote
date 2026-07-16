# run-app

A page that runs [`../../local-runner-showcase.deepnote`](../../local-runner-showcase.deepnote)
locally: edit the inputs, click **Run**, and real Python output — a KPI, a table, a chart, and an
agent-written readout — comes back, powered entirely by
[`@deepnote/local-runner`](../../../packages/local-runner)'s `serveStatic`.

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

The notebook's last block is an **agent block**, which needs an OpenAI key to run locally:

```bash
OPENAI_API_KEY=sk-... pnpm example:local-runner
```

`serve.mjs` also reads a `.env` in the working directory (like `deepnote run`), so the key can live
there instead — the startup banner prints which keys it found. Without one, the dashboard still
renders in full and only the agent block reports the missing key: it runs last, and the engine stops
at the first failing block. `deepnote_agent_model: auto` resolves to `$OPENAI_MODEL` (default
`gpt-5`) locally; in the cloud Deepnote picks the model.

## Run in Deepnote Cloud

The page also has a **Run in cloud** button, wired to `POST /api/run-cloud` → `runInCloud` → the
shared `@deepnote/cloud` client (the same one behind `deepnote run --cloud`). It runs the notebook in
Deepnote Cloud and renders the returned snapshot.

It needs a `DEEPNOTE_TOKEN` — and only that: the agent block runs on Deepnote's side there, so no
`OPENAI_API_KEY` is involved in a cloud run.

```bash
DEEPNOTE_TOKEN=... pnpm example:local-runner
```

One click is enough, whether or not the notebook is in Deepnote yet. If it already exists there, it
runs and the outputs come back with a "view in Deepnote" link. If it doesn't, `runInCloud` creates it
— project, notebook, blocks — and runs it in the same call, reporting `created: true`. Nothing opens
a browser: a token is required either way, so there's no reason to hand the job to a logged-in
session. Without a token the button degrades gracefully and the status line says what's missing.

The first cloud run is the slow one — blocks are created one API request each, so a 16-block notebook
is 16 round-trips before the run even starts. Later runs reuse the notebook and skip straight to it.

## Notes

- HTML outputs (the KPI cards, the table) render in a `sandbox`ed iframe with a **null origin**, so
  output can't reach this page's DOM, storage, or cookies. It isn't sealed off entirely: `allow-scripts`
  is on so the frame can report its height, and `postMessage` is the channel it uses — which is why the
  listener checks both the origin and the sending frame before believing a number.
- Input values are coerced to each block's schema shape before running, so native control values just
  work: the range input hands over the number `7` and the `input-slider` block stores `'7'`, because a
  slider's value is a string in the schema. That is a storage detail, not what your code sees — the
  block's generated Python is `months = 7`, so the kernel has an `int`. A text input stores and
  injects a string, and a checkbox a real `True`/`False`.
