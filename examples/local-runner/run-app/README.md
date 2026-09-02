# run-app

A page that shows every way to compose [`@deepnote/pipelines`](../../../packages/pipelines) — with
**no application server**. Runs, run history, scheduling, and the pipeline are all calls made in
the browser against the Deepnote API.

- **Run** one notebook in Deepnote Cloud. Edit the inputs, click **Run**, and real Python output
  comes back — a KPI, a table, a chart, and an agent-written readout.
- **Schedule** sets up a recurring Deepnote Cloud run of that notebook.
- **Run the pipeline** fans out three regional notebooks, quality-gates their structured
  results, conditionally reruns incomplete data, aggregates the validated portfolio, asks GPT and
  Claude for independent reviews, and fans those reviews into a final arbiter notebook.

The same edited inputs drive all these paths. It's an app shell, not a document: an inputs panel on
the left, a results canvas on the right. [`index.html`](./index.html) does all of the work — no
framework, no frontend build step, and nothing on the server side. [`serve.mjs`](./serve.mjs) is a
static file host for local preview only; it has no API routes and runs no notebooks.

## What the page uses from the library

The page `<script>`s in one file, `pipelines.js`, which is the browser bundle
`@deepnote/pipelines` builds at `packages/pipelines/dist/browser.iife.js`. It defines a single
global, `DeepnotePipelines`, and every call the page makes to Deepnote goes through it — there is no
hand-written `fetch` in the page:

| From `DeepnotePipelines`                                                    | Used for                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `runPipeline`                                                               | The pipeline itself: each `run({ notebookId, inputs })` is one Deepnote Cloud run                  |
| `pipelineOutputs.lastJson`                                                  | Reading a step's result as data — the regional numbers, and each provider's decision               |
| `triggerNotebookRun`, `pollRunUntilComplete`, `waitForRunSnapshot`          | **Run**: start the notebook, follow its status, read its snapshot — the executor's own three calls |
| `getRun`, `fetchSnapshotContent`                                            | Showing a past run from the history panel without re-running it                                    |
| `extractOutputs`                                                            | Turning a snapshot into renderable block outputs                                                   |
| `getNotebook`                                                               | The notebook's name and normalized input definitions, which become the controls                    |
| `listNotebookRuns`                                                          | The run-history panel                                                                              |
| `upsertNotebookSchedule`                                                    | **Schedule**: the cadence, mapped to cron in the page                                              |
| `isTerminalStatus`, `isSuccessStatus`, `isFailedStatus`, `describeRunError` | Reading a run's status and failure the way the library does                                        |

Two things the page renders are not part of the library's normalized run and are read off the raw
response it keeps (`run.raw`): `viewUrl`, the link to the run in Deepnote, and `snapshotBlocks`,
the pre-parsed block outputs a static-app token receives instead of the raw snapshot. Both are
simply absent when the API does not send them.

For comparison, the server routes this app once had, and what replaced them:

| Was a server route         | Now                                                         |
| -------------------------- | ----------------------------------------------------------- |
| `GET /api/info`            | `getNotebook(...)`                                          |
| `POST /api/run`            | `triggerNotebookRun(...)`, then `pollRunUntilComplete(...)` |
| `GET /api/cloud-runs`      | `listNotebookRuns(...)`                                     |
| `POST /api/schedule-cloud` | `upsertNotebookSchedule(...)`                               |
| `POST /api/pipeline`       | `runPipeline(...)` in the page                              |

## What having no server costs

- **Notebooks must already exist.** Steps and runs name a notebook id. There is no
  `createIfMissing`, because a viewer-scoped token may run a notebook, not create one. The
  `.deepnote` files in this folder are the _source_ for the notebooks you create once in Deepnote.
- **There is no local Python kernel.** Every run goes through the Deepnote API. The notebooks' agent
  blocks run on Deepnote's side, so no `OPENAI_API_KEY` is involved anywhere.
- **Run history depends on token scope.** A published app's static-app token may not enumerate a
  notebook's runs; the panel stays hidden rather than erroring when that call is refused.

## Run it

```bash
pnpm example:local-runner
```

That builds the package and starts the static preview. Open the printed URL with a token and the
notebook ids:

```text
http://127.0.0.1:<port>/?token=…&notebookId=…
  &naNotebookId=…&euNotebookId=…&apacNotebookId=…
  &gptNotebookId=…&claudeNotebookId=…&arbiterNotebookId=…
```

A `?token=` is for local testing only. Published to Deepnote and opened from the project, the page
asks the embedding shell over `postMessage` and uses the short-lived, project- and viewer-scoped
token it gets back. The shell names the API origin in the same reply, and that token is only ever
sent to that origin — the two are one credential bundle. No long-lived `DEEPNOTE_TOKEN` is embedded
in the page. The shell's origin is pinned in `APP_CONFIG`, not read from the URL, so a link cannot
choose who the page accepts a token from.

Only `notebookId` is needed for **Run** and **Schedule**. The pipeline needs the regional ids; the
provider and arbiter ids are optional and their nodes report themselves as unconfigured when absent.

## Publish it to Deepnote

The page is static files, so it publishes as a Deepnote website. Copy the bundle next to
`index.html` first — the preview server resolves it from `dist/` on the fly, but a published folder
has to carry its own copy:

```bash
pnpm --filter @deepnote/pipelines build
cp packages/pipelines/dist/browser.iife.js examples/local-runner/run-app/pipelines.js
DEEPNOTE_TOKEN=... deepnote publish examples/local-runner/run-app --project-id <your-project-id> --api-access enabled
```

`--api-access enabled` matters: it is the separate opt-in that lets the shell answer the token
handshake. Without it the page reports that it could not acquire a token. Set the notebook ids in
`APP_CONFIG` inside `index.html` (or pass them as query parameters on the published URL).

## Run the pipeline

Click **Run the pipeline**. The pipeline itself is control flow in the page —
`Promise.all`, a filter, a conditional rerun — and each step is a Deepnote Cloud run:

```text
North America ─┐
Europe ────────┼─ quality gate ─ Europe recovery ─ aggregate ─┬─ GPT-5.5 ───────┐
Asia Pacific ──┘                                              └─ Claude Sonnet 5 ┴─ Auto arbiter
```

Europe deliberately starts with one missing month. Its quality score falls below 95%, so only that
region reruns with backfilling. The page then shows the validated regional table, forecast-versus-
target decision, number of notebook runs, recovery count, both provider reviews, and the arbiter's
final decision.

Every step's result is read as data with `pipelineOutputs.lastJson(step)`, so nothing depends on
source block ids surviving cloud creation. That includes the verdicts: each decision notebook asks
its agent to record the review in a `decision_review` dict and ends with a code block that prints
it as one JSON object — `{"decision": "proceed" | "intervene", "rationale": "…", "nextAction": "…"}`
— so the page never pattern-matches the agent's prose. A verdict that is missing or not one of the
two words renders as "unavailable".

Every notebook node becomes a keyboard-focusable link to that exact run as soon as its `viewUrl`
arrives. The quality gate and aggregation stay non-clickable because they are pipeline
decisions, not notebook executions.

This is one-shot coordination: it holds its state in the page and is gone if the tab closes, which
is the right trade for an interactive app.

The pipeline here is written in JavaScript. The same shape can live in a file instead — see
[`../../pipelines/sales-pipeline.deepnote`](../../pipelines/sales-pipeline.deepnote) and the
`.deepnote` pipeline section of the [package README](../../../packages/pipelines/README.md).

## Schedule recurring cloud runs

The **Schedule** control sends a Daily, Weekly (choose weekday), or Monthly (choose calendar day)
cadence plus time and timezone. The page converts that cadence to cron and calls
`POST /v2/notebooks/{id}/schedule`. Recurring runs use the input values stored in Deepnote, not the
ones currently in the panel. Deepnote allows one scheduled notebook per project, so saving again
updates that project schedule.

## Notes

- HTML outputs (the KPI cards, the table) render in a `sandbox`ed iframe with a **null origin**, so
  output can't reach this page's DOM, storage, or cookies. It isn't sealed off entirely: `allow-scripts`
  is on so the frame can report its height, and `postMessage` is the channel it uses — which is why the
  listener checks both the origin and the sending frame before believing a number.
- `POST /v2/runs` accepts only strings, booleans, and string arrays, so input values are coerced
  before they are sent: the range input hands over the number `7` and the request carries `'7'`.
  That is a transport detail, not what your code sees — the block's generated Python is `months = 7`,
  so the kernel has an `int`.
