# @deepnote/pipelines

Compose Deepnote notebook runs into pipelines. No server, no kernel, no orchestration engine.

```bash
pnpm add @deepnote/pipelines
```

## Run several notebooks as one pipeline

Fan out, gate on the results, decide:

```ts
import { runPipeline } from "@deepnote/pipelines";

const { value, graph } = await runPipeline(
  async ({ run, control, outputs }) => {
    const analyses = await Promise.all(
      REGIONS.map((region) =>
        run({
          id: region.name,
          notebookId: region.notebookId,
          inputs: { region: region.name },
        }),
      ),
    );
    const readings = analyses.map((step) => outputs.lastJson(step));

    const failing = await control(
      {
        id: "quality-gate",
        kind: "gate",
        dependsOn: analyses.map((s) => s.id),
      },
      () => readings.filter((r) => r.qualityScore < 0.95).map((r) => r.region),
    );

    return { checked: readings.length, failing };
  },
  { token, onEvent: (event) => render(event) },
);
```

This is deliberately an imperative API, not a workflow language: `await`, `Promise.all`, loops and
branches in the callback provide sequencing, concurrency, and conditionals. The library records what
happened — the graph, the events, the normalized results. One guard rail: `concurrency` (default 10)
caps how many notebook steps are in flight at once, so a large fan-out does not start every run at
the same instant.

**It needs no server and no local kernel.** Every step is an HTTP call to Deepnote, so the same
pipeline runs in a script, in CI, and in a browser page. Nothing reachable from `runPipeline`
imports `node:*`.

Notebooks are addressed by id and must already exist. Running a pipeline needs permission to run a
notebook, not to create one — which is what lets a page do it with a viewer's short-lived token.

`control` records a local decision as a node, so a gate or an aggregation shows up in the graph
instead of happening invisibly between steps. `outputs.lastJson(step)` and
`outputs.lastAgentText(step)` read a step's results without depending on block ids, which Deepnote
reassigns when it creates a notebook. `lastJson` needs the last block's output to _end_ with a JSON
value; anything printed before it on earlier lines is ignored, so a summary `print` before the
`json.dumps` is fine. A later block that prints only prose is skipped. When nothing parses, the
error quotes the last 200 characters the block printed.

`runPipelineWithExecutor(workflow, options, executor)` is the same engine with the runner left open, for
callers that want to run steps somewhere else.

See [`examples/pipelines/script`](../../examples/pipelines/script).

## When a step fails

A failed notebook rejects the pipeline with `PipelineStepError` unless the step has
`allowFailure: true`, in which case its failed result is returned and the callback decides what to
do. Infrastructure failures — no credentials, an unknown notebook, an unreadable API response — are
step errors too, attributed to the step that hit them.

The rejection does not discard the run. Every error the engine throws carries `partial`: the `steps`
that finished, in start order exactly as the success path returns them, the `graph` with each node's
status, and `startedAt`, `finishedAt`, `durationMs`. Steps still in flight when the pipeline threw are
absent from `steps` and still `running` in the graph. `PipelineStepError` additionally names the
`stepId` and carries the failing step's own `result`. Anything else the callback throws — a control
node, a graph mistake such as a duplicate node id, your own code — is wrapped in `PipelineRunError`
with the same `partial` and the original error as `cause`.

```ts
try {
  await runPipeline(workflow, { token });
} catch (error) {
  if (error instanceof PipelineStepError || error instanceof PipelineRunError) {
    render(error.partial.graph); // what finished, and where it stopped
  }
  throw error;
}
```

The resolved shape is unchanged: a pipeline that returns gets `value`, `steps`, `graph` and the
timings as before.

## What this is not

It is not durable. Coordination state lives in the process that called `runPipeline`: if that
process dies, the individual notebook runs continue in Deepnote — they are detached — but nothing
aggregates them and no gate fires. Durability comes from putting the pipeline somewhere durable,
not from a layer here; a scheduled Deepnote notebook is the cheapest such place.

It is not a scheduler, a worker pool, a task queue, or a replay engine. Deepnote already runs, retries
and schedules notebooks; this only decides which one runs next and what its result means.

## Reading a run's results

Snapshot reading lives here too, for the same reason the pipeline does: it is pure parsing with no
Node dependencies, so a page can render a finished run on its own.

```ts
import { parseSnapshot } from "@deepnote/pipelines";

const view = parseSnapshot(snapshotYaml);
```

`@deepnote/local-runner` re-exports `parseSnapshot`, `toSnapshotView` and the snapshot types, and
also ships them as a browser bundle at `@deepnote/local-runner/snapshot-reader`.

## License

Apache-2.0
