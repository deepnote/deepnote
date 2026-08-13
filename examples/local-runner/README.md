# @deepnote/local-runner examples

Two small reference apps, one for each way you'd surface a `.deepnote` notebook on the web. They
share a visual language on purpose — the difference is the deployment model, not the styling.

| Example                                  | What it is                                                                                                           | Needs a server?     | Run it                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------ |
| [**run-app**](./run-app)                 | A page that **runs or schedules** the notebook locally or in Deepnote Cloud, with editable inputs and cloud history. | Yes — `serveStatic` | `pnpm example:local-runner`    |
| [**snapshot-viewer**](./snapshot-viewer) | A fully static page that **views** an already-run snapshot — outputs, charts, and an agent readout, with no kernel.  | No                  | `pnpm example:snapshot-viewer` |

The rule of thumb: **run notebooks when you have a server; view snapshots when you only have static
hosting.** Both scripts build the package first, so a clean checkout works with one command.

Both examples draw on two committed artifacts at the `examples/` root:

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
