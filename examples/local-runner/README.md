# @deepnote/local-runner examples

Reference apps for running, viewing, and composing `.deepnote` notebooks. They share a visual
language on purpose — the difference is the deployment model, not the styling.

| Example                                                | What it is                                                                                                                                                                                          | Needs a server?       | Run it                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------- |
| [**run-app**](./run-app)                               | A page that **runs or schedules** the notebook in Deepnote Cloud, with editable inputs and cloud history, **and** a live fan-out → quality gate → GPT/Claude review → arbiter — all in the browser. | No application server | `pnpm example:local-runner`           |
| [**cloud-app**](./cloud-app)                           | A published client-only app that **runs one configured notebook** in Deepnote Cloud with the signed-in viewer's short-lived credentials.                                                            | No application server | Publish to Deepnote                   |
| [**snapshot-viewer**](./snapshot-viewer)               | A fully static page that **views** an already-run snapshot — outputs, charts, and an agent readout, with no kernel.                                                                                 | No                    | `pnpm example:snapshot-viewer`        |
| [**client-orchestration**](./client-orchestration)     | The pipeline on its own — fan-out → quality gate → arbiter, with no inputs panel, history, or scheduling. The smallest client-only orchestration to copy from.                                      | No application server | `pnpm example:client-orchestration`   |
| [**orchestration**](./orchestration)                   | A one-shot local-or-cloud pipeline using plain TypeScript control flow, normalized results, and output helpers.                                                                                     | No — a Node script    | `pnpm example:orchestration`          |
| [**workflow-orchestration**](./workflow-orchestration) | An end-to-end durable decision pipeline: regional fan-out, contained failure, quality-gated recovery, aggregation, and an agent memo.                                                               | Yes — Vite dev server | `pnpm example:workflow-orchestration` |

The rule of thumb: **a notebook that already exists in Deepnote needs no server at all** — running
it, scheduling it, reading its history, and orchestrating several of them are all API calls a page
can make. A server buys exactly two things: a local Python kernel, and creating notebooks from local
files. `orchestration` and `workflow-orchestration` are Node because they are scripts, not because
orchestration needs a process. The root scripts build the packages they need, so a clean checkout
works with one command.

The run app's orchestration makes model-provider choice visible rather than hiding it behind
`auto`: the same validated portfolio and constrained decision prompt fan out concurrently to
**OpenAI GPT-5.5** and **Anthropic Claude Sonnet 5** in Deepnote Cloud. The result compares their
independent recommendations, and every notebook node and review links to its exact cloud run.
Those branches then fan back into a final Deepnote Auto arbiter, which weighs both memos against the
validated data and owns the concluding decision. Every one of those steps is a Deepnote Cloud run
started from the browser, so the pipeline needs a viewer's token and nothing else.

The run app and snapshot viewer draw on two committed artifacts at the `examples/` root:

- [`local-runner-showcase.deepnote`](../local-runner-showcase.deepnote) — an input-rich sales
  dashboard (a KPI, a table, a chart, and a written summary), closing with an **agent block** that
  writes an executive readout. The dashboard is deterministic and key-free; only the agent block
  needs a key, and it runs last, so a keyless run still renders the whole dashboard and reports the
  error on that block alone.
- [`snapshot-showcase.snapshot.deepnote`](../snapshot-showcase.snapshot.deepnote) — that dashboard,
  already run, plus an **agent block with precomputed output**. The snapshot viewer renders it with
  zero setup, showing agent-block support without anyone needing an API key.

There is also a small, copyable scheduling smoke test:

```bash
DEEPNOTE_TOKEN=... pnpm example:schedule-cloud
```

It schedules [`scheduled-cloud-run.deepnote`](../scheduled-cloud-run.deepnote) for weekdays at
09:00 in the system timezone. Override `DEEPNOTE_SCHEDULE_CRON` or
`DEEPNOTE_SCHEDULE_TIMEZONE` to test another cadence.
