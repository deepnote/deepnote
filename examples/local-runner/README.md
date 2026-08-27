# @deepnote/local-runner examples

Three small reference apps for surfacing a `.deepnote` notebook on the web. They share a visual
language on purpose — the difference is the deployment model, not the styling.

| Example                                  | What it is                                                                                                                                                                                          | Needs a server?       | Run it                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------ |
| [**run-app**](./run-app)                 | A page that **runs or schedules** the notebook in Deepnote Cloud, with editable inputs and cloud history, **and** a live fan-out → quality gate → GPT/Claude review → arbiter — all in the browser. | No application server | `pnpm example:local-runner`    |
| [**cloud-app**](./cloud-app)             | A published client-only app that **runs one configured notebook** in Deepnote Cloud with the signed-in viewer's short-lived credentials.                                                            | No application server | Publish to Deepnote            |
| [**snapshot-viewer**](./snapshot-viewer) | A fully static page that **views** an already-run snapshot — outputs, charts, and an agent readout, with no kernel.                                                                                 | No                    | `pnpm example:snapshot-viewer` |

Use the run app when you want inputs, scheduling, cloud run history, and a multi-notebook pipeline
in one page; it runs every notebook in Deepnote Cloud and needs only static hosting. Use the cloud
app for a smaller published UI that runs one configured notebook. Use the snapshot viewer when the
output is already available and no execution is needed. The run-app and snapshot-viewer scripts
build the package and start a static preview server, so a clean checkout works with one command.

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
