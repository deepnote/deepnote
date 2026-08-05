# One-shot notebook orchestration

This is the smallest useful pipeline: two source notebooks feed a third notebook, which finishes
with an agent block. Local kernels run the two source notebooks in parallel; cloud execution runs
them sequentially so two first runs cannot race to create the same notebook.

```bash
pnpm example:orchestration
```

When `DEEPNOTE_TOKEN` is set (including through the repository's `.env`), every step uses Deepnote
Cloud, including the final agent block. Otherwise it runs locally, which needs a Python environment
with `deepnote-toolkit[server]` and a model key for the agent. A failed agent report remains
available for inspection, so it does not discard the successful preparation steps.

The important part is [`run.mjs`](./run.mjs): standard `await`, `Promise.all`, loops, and conditions
compose `ctx.run(...)` calls. `ctx.control(...)` records local joins and decisions, while
`dependsOn` records their actual edges. The returned graph therefore describes the pipeline that
really ran—including timing and cloud links—without a separately maintained diagram or pipeline
DSL. Its regional fan-out and join are packaged with `definePipeline` and invoked as
`regional-preparation`; child IDs such as `regional-preparation/north-inputs` are scoped
automatically, so the component can be reused without collisions. Each regional notebook also uses
one reusable, explicitly idempotent retry policy. Attempt nodes remain visible, while downstream
dependencies use the stable policy node rather than whichever attempt succeeded.

To checkpoint the run locally, provide a state file:

```bash
ORCHESTRATION_STATE_FILE=.deepnote-runs/one-shot.json pnpm example:orchestration
```

If the process exits, run the same command again. Completed matching nodes are restored and only
unfinished work runs again. Delete the state file or choose another path for a fresh run. Recovery
is at-least-once for a notebook interrupted before its checkpoint; the Workflow SDK example is the
full durable option.
