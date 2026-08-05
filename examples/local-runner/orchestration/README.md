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

Set `ORCHESTRATION_TARGET=local` to force local execution on a machine that has a token in `.env`:

```bash
ORCHESTRATION_TARGET=local pnpm example:orchestration
```

The important part is [`run.mjs`](./run.mjs): standard `await`, `Promise.all`, loops, and conditions
compose `ctx.run(...)` calls. `ctx.control(...)` records local joins and decisions, while
`dependsOn` records their actual edges. The returned graph therefore describes the pipeline that
really ran—including timing and cloud links—without a separately maintained diagram or pipeline
DSL.

Retry and reuse are ordinary code rather than library configuration. `runWithRetry` is a loop, and
the regional fan-out and join are a plain function that takes the orchestration context and an ID
prefix, so its child nodes appear as `regional-preparation/north-inputs` without a registry. Both
handle two different failures: a notebook that ran and failed returns `success: false`, while
infrastructure that never got the notebook running throws regardless of `allowFailure`. The local
fan-out depends on that second case — two kernels can race for a toolkit port, and the loop retries
the loser.

This example is not durable: it holds its state in memory and a process exit loses the run. See
[`../workflow-orchestration`](../workflow-orchestration) for the same shape under Workflow SDK,
where the identical loop resumes at the attempt it reached.
