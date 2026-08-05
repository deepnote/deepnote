# run-app

A page that shows every way to compose [`@deepnote/local-runner`](../../../packages/local-runner):

- **Run** one notebook in a local Python kernel.
- **Run in cloud** runs that notebook in Deepnote Cloud.
- **Schedule** sets up a recurring Deepnote Cloud run of that notebook.
- **Run orchestrated pipeline** fans out three regional notebooks, quality-gates their structured
  results, conditionally reruns incomplete data, aggregates the validated portfolio, asks GPT and
  Claude for independent reviews, and fans those reviews into a final arbiter notebook.

The same edited inputs drive all these paths. Single runs use
[`../../local-runner-showcase.deepnote`](../../local-runner-showcase.deepnote), returning a KPI, a
table, a chart, and an agent-written readout.

It's an app shell, not a document: an inputs panel on the left, a results canvas on the right. Two
files do the work — [`serve.mjs`](./serve.mjs) (`serveStatic({ dir, notebookPath })`, plus an
application-owned `orchestrationRunner`) and [`index.html`](./index.html) (`GET /api/info` to build
the controls, then the run, schedule, and history APIs to drive the page, and the pipeline's NDJSON
progress to render the live fork/join graph and decision). No framework, no frontend build step.

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

## Run the pipeline

Click **Run orchestrated pipeline** in the same page. The orchestration always runs in the local Node
process; each notebook step runs in Deepnote Cloud when `DEEPNOTE_TOKEN` is present, otherwise in
local Python kernels. This is one-shot orchestration, so it needs no Workflow SDK server.

The live graph makes the control flow visible instead of flattening concurrent work into a list:

```text
North America ─┐
Europe ────────┼─ quality gate ─ Europe recovery ─ aggregate ─┬─ GPT-5.5 ───────┐
Asia Pacific ──┘                                              └─ Claude Sonnet 5 ┴─ Auto arbiter
```

Europe deliberately starts with one missing month. Its quality score falls below 95%, so only that
region reruns with backfilling. The page then shows the validated regional table, forecast-versus-
target decision, number of notebook runs, recovery count, both provider reviews, and the arbiter's
final decision. The backend uses `outputs.lastJson(step)`, so it does not depend on source block IDs
surviving cloud creation.

When the pipeline targets Deepnote Cloud, every notebook node becomes a keyboard-focusable link to
that exact run as soon as its `viewUrl` arrives. The quality gate and aggregation stay non-clickable
because they are local orchestration decisions, not notebook executions.

The GPT-5.5 and Claude Sonnet 5 reviews and the final Deepnote Auto arbiter run only in Deepnote
Cloud, so they require `DEEPNOTE_TOKEN`. Without it, the regional fan-out, quality gate, recovery,
aggregation, and rule-based proposal still complete locally; the page marks the provider and
arbiter nodes as cloud-only.

## Schedule recurring cloud runs

The **Schedule** control is a thin frontend over `POST /api/schedule-cloud`. It sends a structured
Daily, Weekly (choose weekday), or Monthly (choose calendar day) cadence plus time and timezone.
`serveStatic` validates and converts that cadence to cron before calling `scheduleInCloud`, so custom
frontends can reuse the scheduling behavior without implementing cron conversion. Advanced
frontends can still send raw cron.

Scheduling creates the cloud notebook if necessary but does not run it immediately. Recurring runs
use the input values stored in Deepnote; when scheduling creates the notebook, those are the
defaults committed in the `.deepnote` file. Deepnote allows one scheduled notebook per project, so
saving again updates that project schedule.

The scheduler remains available while a cloud run is active. The local-runner library coordinates
the first create-if-missing operation, so custom frontends can safely offer the same concurrency
without implementing their own lock.

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
