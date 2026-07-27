# @deepnote/local-runner examples

Reference apps for running, viewing, and composing `.deepnote` notebooks.

| Example                                                | What it is                                                                                                           | Run it                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [**run-app**](./run-app)                               | A page that **runs** a notebook with edited inputs against a local Python kernel or Deepnote Cloud.                  | `pnpm example:local-runner`           |
| [**snapshot-viewer**](./snapshot-viewer)               | A fully static page that **views** an already-run snapshot — outputs, charts, and an agent readout, with no kernel.  | `pnpm example:snapshot-viewer`        |
| [**orchestration**](./orchestration)                   | A one-shot local-or-cloud pipeline using plain TypeScript control flow, normalized results, and output helpers.      | `pnpm example:orchestration`          |
| [**workflow-orchestration**](./workflow-orchestration) | The same pattern as a durable, observable Workflow SDK pipeline whose notebook and agent steps execute in the cloud. | `pnpm example:workflow-orchestration` |

The rule of thumb: **run notebooks when you have a server; view snapshots when you only have static
hosting; orchestrate when several runs form one result.** The root scripts build the packages they
need, so a clean checkout works with one command.

Both examples draw on two committed artifacts at the `examples/` root:

- [`local-runner-showcase.deepnote`](../local-runner-showcase.deepnote) — an input-rich sales
  dashboard (a KPI, a table, a chart, and a written summary), closing with an **agent block** that
  writes an executive readout. The dashboard is deterministic and key-free; only the agent block
  needs a key, and it runs last, so a keyless run still renders the whole dashboard and reports the
  error on that block alone.
- [`snapshot-showcase.snapshot.deepnote`](../snapshot-showcase.snapshot.deepnote) — that dashboard,
  already run, plus an **agent block with precomputed output**. The snapshot viewer renders it with
  zero setup, showing agent-block support without anyone needing an API key.
