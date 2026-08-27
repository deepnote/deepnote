# run-app

A page that shows every way to compose [`@deepnote/local-runner`](../../../packages/local-runner) —
with **no application server**. Runs, run history, scheduling, and the orchestrated pipeline are all
`fetch` calls made in the browser against the Deepnote API.

- **Run** one notebook in Deepnote Cloud. Edit the inputs, click **Run**, and real Python output
  comes back — a KPI, a table, a chart, and an agent-written readout.
- **Schedule** sets up a recurring Deepnote Cloud run of that notebook.
- **Run orchestrated pipeline** fans out three regional notebooks, quality-gates their structured
  results, conditionally reruns incomplete data, aggregates the validated portfolio, asks GPT and
  Claude for independent reviews, and fans those reviews into a final arbiter notebook.

The same edited inputs drive all these paths. It's an app shell, not a document: an inputs panel on
the left, a results canvas on the right. [`index.html`](./index.html) does all of the work — no
framework, no frontend build step, and nothing on the server side. [`serve.mjs`](./serve.mjs) is a
static file host for local preview only; it has no API routes and runs no notebooks.

## Which API calls replace which server routes

The app used to run behind `serveStatic`. Every route it provided is a plain Deepnote endpoint the
page now calls directly:

| Was                        | Now                                                     |
| -------------------------- | ------------------------------------------------------- |
| `GET /api/info`            | `GET /v2/notebooks/{id}` — normalized input definitions |
| `POST /api/run`            | `POST /v2/runs`, then poll `GET /v2/runs/{runId}`       |
| `GET /api/cloud-runs`      | `GET /v2/notebooks/{id}/runs`                           |
| `POST /api/schedule-cloud` | `POST /v2/notebooks/{id}/schedule`                      |
| `POST /api/orchestrate`    | `orchestrateInCloud(...)` in the page                   |

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
in the page.

Only `notebookId` is needed for **Run** and **Schedule**. The pipeline needs the regional ids; the
provider and arbiter ids are optional and their nodes report themselves as unconfigured when absent.

## Run the pipeline

Click **Run orchestrated pipeline**. The orchestration itself is control flow in the page —
`Promise.all`, a filter, a conditional rerun — and each step is a Deepnote Cloud run:

```text
North America ─┐
Europe ────────┼─ quality gate ─ Europe recovery ─ aggregate ─┬─ GPT-5.5 ───────┐
Asia Pacific ──┘                                              └─ Claude Sonnet 5 ┴─ Auto arbiter
```

Europe deliberately starts with one missing month. Its quality score falls below 95%, so only that
region reruns with backfilling. The page then shows the validated regional table, forecast-versus-
target decision, number of notebook runs, recovery count, both provider reviews, and the arbiter's
final decision. It uses `outputs.lastJson(step)`, so it does not depend on source block IDs
surviving cloud creation.

Every notebook node becomes a keyboard-focusable link to that exact run as soon as its `viewUrl`
arrives. The quality gate and aggregation stay non-clickable because they are orchestration
decisions, not notebook executions.

This is one-shot orchestration: it holds its state in the page and is gone if the tab closes. That
is the right trade for an interactive app and the wrong one for anything scheduled — for those, see
[Workflow SDK](../../../packages/local-runner/README.md#make-notebook-steps-durable-with-workflow-sdk).

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
