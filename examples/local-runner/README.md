# @deepnote/local-runner examples

Reference apps for running, viewing, and composing `.deepnote` notebooks.

| Example                                                | What it is                                                                                                                            | Run it                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [**run-app**](./run-app)                               | An interactive page for single local/cloud runs **and** a live fan-out → quality gate → GPT/Claude review → final arbiter.            | `pnpm example:local-runner`           |
| [**snapshot-viewer**](./snapshot-viewer)               | A fully static page that **views** an already-run snapshot — outputs, charts, and an agent readout, with no kernel.                   | `pnpm example:snapshot-viewer`        |
| [**orchestration**](./orchestration)                   | A one-shot local-or-cloud pipeline using plain TypeScript control flow, normalized results, and output helpers.                       | `pnpm example:orchestration`          |
| [**workflow-orchestration**](./workflow-orchestration) | An end-to-end durable decision pipeline: regional fan-out, contained failure, quality-gated recovery, aggregation, and an agent memo. | `pnpm example:workflow-orchestration` |

The rule of thumb: **run notebooks when you have a server; view snapshots when you only have static
hosting; orchestrate when several runs form one result.** The root scripts build the packages they
need, so a clean checkout works with one command.

The run app's orchestration makes model-provider choice visible rather than hiding it behind
`auto`: the same validated portfolio and constrained decision prompt fan out concurrently to
**OpenAI GPT-5.5** and **Anthropic Claude Sonnet 5** in Deepnote Cloud. The result compares their
independent recommendations, and every notebook node and review links to its exact cloud run.
Those branches then fan back into a final Deepnote Auto arbiter, which weighs both memos against the
validated data and owns the concluding decision. Regional analysis can still run locally; native
multi-provider selection requires `DEEPNOTE_TOKEN`.

Both examples draw on two committed artifacts at the `examples/` root:

- [`local-runner-showcase.deepnote`](../local-runner-showcase.deepnote) — an input-rich sales
  dashboard (a KPI, a table, a chart, and a written summary), closing with an **agent block** that
  writes an executive readout. The dashboard is deterministic and key-free; only the agent block
  needs a key, and it runs last, so a keyless run still renders the whole dashboard and reports the
  error on that block alone.
- [`snapshot-showcase.snapshot.deepnote`](../snapshot-showcase.snapshot.deepnote) — that dashboard,
  already run, plus an **agent block with precomputed output**. The snapshot viewer renders it with
  zero setup, showing agent-block support without anyone needing an API key.
