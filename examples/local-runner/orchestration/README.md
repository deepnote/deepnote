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
compose `ctx.run(...)` calls. The same step definitions target local kernels or cloud runs. There is
no pipeline DSL or server to configure.
