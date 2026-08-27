# scheduled-pipeline

Run a `.deepnote` pipeline **on a schedule**, with no workflow engine and no server of your own.

Deepnote already schedules one notebook. Point that at [`runner.deepnote`](./runner.deepnote) and a
whole pipeline runs on a schedule: the run is an ordinary Deepnote run — durable, retryable, and
visible in Deepnote's own UI — while the pipeline definition stays in a file.

## Why not just schedule the pipeline file itself?

Because Deepnote's block engine would do the wrong thing quietly, which is worse than failing.

- It **runs blocks strictly in order**, so a fan-out that should be concurrent is serialized.
- It **knows nothing about `run_if`, `for_each`, or `{{ }}`** — those are read by this interpreter,
  not by Deepnote. A conditional recovery step would run unconditionally, a fan-out would run once,
  and `{{portfolio}}` would be passed through as that literal string.
- Native `notebook-function` inputs are **baked as a static JSON literal** at authoring time, so no
  value can flow from one step into the next.

So the scheduled artifact is a _runner_ that interprets the manifest, not the manifest itself.

## Use it

1. Create `runner.deepnote` as a notebook in your Deepnote project.
2. Put your pipeline manifest in the same project (see
   [`../sales-pipeline.deepnote`](../sales-pipeline.deepnote)) and set the **manifest path** input.
3. Set `DEEPNOTE_TOKEN` in the project's environment variables.
4. Schedule the notebook.

The notebook is self-contained: the interpreter is embedded in a code block, so it does not depend
on this repository being present. Its CLI entry point is stripped, because a notebook cell runs with
`__name__ == "__main__"` and would otherwise try to parse command-line arguments.

## Run it locally first

```bash
python3 packages/local-runner/python/deepnote_pipeline.py --plan examples/local-runner/sales-pipeline.deepnote
DEEPNOTE_TOKEN=… python3 packages/local-runner/python/deepnote_pipeline.py --run examples/local-runner/sales-pipeline.deepnote
```

`--plan` prints the DAG and runs nothing, which is the fastest way to check a manifest.

## Two implementations, one set of semantics

The interpreter exists in TypeScript (for the browser and scripts) and in Python (here). Two
implementations of one language is a standing risk that they quietly diverge, so
[`test-fixtures/pipeline-conformance`](../../../test-fixtures/pipeline-conformance) is the contract:
both planners must produce identical plans for every fixture, and `pipeline-conformance.test.ts`
fails if they do not.

If you change `run_if`, `for_each`, `{{ }}`, or dependency derivation, change it in both and add a
fixture that would have caught the difference.

## What this does not do

Steps run concurrently within the notebook run, and the run itself is durable — but there is no
resume: if the notebook run fails halfway, rerunning starts from the beginning. Notebook runs are
not automatically idempotent, so re-running a pipeline re-runs its side effects. For replay,
per-step retries, and timers, use the Workflow SDK integration in
[`@deepnote/local-runner/workflows`](../../../packages/local-runner/README.md) instead.
