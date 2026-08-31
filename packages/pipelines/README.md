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
happened — the graph, the events, the normalized results.

**It needs no server and no local kernel.** Every step is an HTTP call to Deepnote, so the same
pipeline runs in a script, in CI, and in a browser page. Nothing reachable from `runPipeline`
imports `node:*`.

Notebooks are addressed by id and must already exist. Running a pipeline needs permission to run a
notebook, not to create one — which is what lets a page do it with a viewer's short-lived token.

`control` records a local decision as a node, so a gate or an aggregation shows up in the graph
instead of happening invisibly between steps. `outputs.lastJson(step)` and
`outputs.lastAgentText(step)` read a step's results without depending on block ids, which Deepnote
reassigns when it creates a notebook.

A failed notebook throws `PipelineStepError` carrying the result, so a caller can still show
how far the run got; `allowFailure: true` returns it instead.

`runPipelineWithExecutor(workflow, options, executor)` is the same engine with the runner left open, for
callers that want to run steps somewhere else.

See [`examples/pipelines/script`](../../examples/pipelines/script).

## Define a pipeline in a `.deepnote` file

`runPipeline` puts the pipeline in application code. A pipeline can instead live in a file: a parent
notebook whose `notebook-function` blocks each name an external notebook, the inputs to run it with,
and the values it publishes.

```yaml
- id: analyze-europe
  type: notebook-function
  metadata:
    function_notebook_id: nb-regional
    function_notebook_inputs: { region: Europe, trailing_months: "6" }
    function_notebook_export_mappings:
      region: { enabled: true, variable_name: europe }

- id: aggregate
  type: notebook-function
  metadata:
    function_notebook_id: nb-aggregate
    function_notebook_inputs:
      regions_json: "[{{northAmerica}}, {{europe}}, {{asiaPacific}}]"
```

```ts
import { runPipelineFile, planPipeline } from "@deepnote/pipelines";

const { value, plan, graph } = await runPipelineFile(file, {
  token,
  onEvent,
});
```

**Dependencies are never declared twice.** A step reading `{{europe}}` depends on whichever step
exports `europe`, so the three regional steps above are independent _by construction_ and run
concurrently. This is the same variable-flow model the reactivity package already applies to
notebook-function blocks. `planPipeline(file)` returns that graph without running anything, so
a UI can draw the pipeline before it starts.

A whole-value reference keeps its type — `"{{portfolio}}"` passes the object, not `"[object
Object]"` — while a reference inside surrounding text interpolates. A step's exports are read from
its last structured JSON output, so they survive Deepnote reassigning block ids.

**The parent is interpreted, not executed.** That is the point of the design rather than an
implementation detail: Deepnote's block engine runs blocks strictly in order, so handing it the
parent would serialize the fan-out into one run with one status. Reading it as a manifest keeps
concurrency and per-step events, while the definition still lives in a versioned, reviewable file
instead of in a page.

Errors that a graph can be checked for are raised at plan time, before anything runs: a reference no
step exports, two steps exporting the same variable, a step naming no notebook, and dependency
cycles.

### Gates: `run_if`

A step's _existence_ can depend on an earlier result, so a gate lives in the file too:

```yaml
- id: final-arbiter
  type: notebook-function
  metadata:
    run_if: gptReview.decision != claudeReview.decision
    function_notebook_id: nb-arbiter
```

The condition reads exported variables, so the step depends on what it consults without that being
written down twice. When it is false the step is skipped, and so is anything that reads what it
would have exported — a dependent is never run with a value that will never arrive. Skipped steps
come back in `result.skipped` rather than being silently absent, and each gate appears in the graph
as a `gate` node between the steps it reads and the step it governs.

The condition language is deliberately **not JavaScript**: a pipeline definition is data, and a file
that runs arbitrary code in whoever opens it is a different and much worse thing than a file that
describes a graph. There is no `eval`, no calls, no assignment, and no prototype access — property
lookups are own-properties only. It supports comparisons (`< <= > >= == !=`), `&& || !`, parentheses,
numeric indexing, and literals. A malformed condition fails at plan time.

`==` and `===` are the same comparison and both treat an absent value as `null`, so a gate can ask
whether an earlier step published anything (`upstream.value != null`). Strict equality would make
that always false, and the Python interpreter has no `undefined` to distinguish anyway.

### Dynamic fan-out: `for_each`

A step's _width_ can come from the data rather than the file — one run per element, all concurrent:

```yaml
- id: recover
  type: notebook-function
  metadata:
    for_each: "{{regions}}" # or a list written inline, whose items may be references
    for_each_as: region # each element is bound to this name
    run_if: region.qualityScore < 0.95 # evaluated per element
    function_notebook_inputs:
      region: "{{region.name}}"
    function_notebook_export_mappings:
      region: { enabled: true, variable_name: recovered }
```

`run_if` on a fan-out is evaluated per element, so this is conditional recovery: one run for each
region that failed the gate, and none at all when they all passed. Exports collect into an array in
element order, so `recovered` is the list of what actually ran.

**A fan-out always publishes a list, even when it ran nothing** — an empty input list and every
element being gated off both give `[]` rather than a skip. Both mean "no element qualified", so
downstream gets the same true answer either way, and a pipeline does not break on the happy path
where nothing needed recovering. A `for_each` over something that is not an array is an error naming
the step.

The fan-out also appears in the graph as a single `join` node its runs converge on, so a later step
can depend on it by name.

The loop variable is bound by the step, so it is not a dependency on anything; the step depends on
whatever the list and the other references consult.

### Optional values: `??`

A reference is a chain of alternatives, and the first with a value wins:

```yaml
recovered_json: "{{recovered ?? null}}"
data: "{{recovered ?? original}}"
retries: "{{attempts ?? 0}}"
```

This is what keeps a gate from poisoning everything downstream. Without it, a step reading a value
from a _plain_ gated step is skipped whenever that gate was false — correct, but it cascades. With a
fallback the step runs on whatever is available. A step is skipped only when a reference has _no_
satisfiable alternative; a gated fan-out needs no fallback, because it publishes an empty list.
Literals (numbers, quoted strings, `true`, `false`, `null`) are allowed as the last resort, and a
step depends on every alternative, since which one wins is a run-time fact.

### What is still code

`runPipeline` remains the answer for logic that is genuinely computation rather than topology:
reshaping or merging results between steps, retry policies with backoff, and anything that needs a
library. A file describes a graph — its steps, their gates, and their width — and that is the
boundary worth keeping.

See [`examples/pipelines/sales-pipeline.deepnote`](../../examples/pipelines/sales-pipeline.deepnote).

## What this is not

It is not durable. Coordination state lives in the process that called `runPipeline`: if that
process dies, the individual notebook runs continue in Deepnote — they are detached — but nothing
aggregates them and no gate fires. Durability comes from putting the pipeline somewhere durable,
not from a layer here; a scheduled Deepnote notebook is the cheapest such place.

It is not a scheduler, a worker pool, a task queue, or a replay engine. Deepnote already runs, retries
and schedules notebooks; this only decides which one runs next and what its result means.

## Make a pipeline durable

`runPipeline` holds its state in one process and is gone if that process is. That is the right trade
for a script or an interactive page, and the wrong one for anything scheduled or long-lived.

Rather than growing a checkpoint/resume layer — which is how orchestration libraries turn into bad
workflow engines — durability is delegated. `@deepnote/pipelines/workflows` exposes one notebook
run as a step you compose inside a [Workflow SDK](https://www.npmjs.com/package/workflow) function:

```ts
import { lastOutputJson } from "@deepnote/pipelines";
import { runNotebookStep } from "@deepnote/pipelines/workflows";

export async function salesReview() {
  "use workflow";

  const regions = await Promise.all(
    REGIONS.map((region) =>
      runNotebookStep({ id: region.name, notebookId: region.notebookId }),
    ),
  );
  const failing = regions.filter((r) => lastOutputJson(r).qualityScore < 0.95);
  return runNotebookStep({
    id: "arbiter",
    notebookId: ARBITER,
    inputs: { failing: failing.length },
  });
}
```

Replay, retries, timers, and observability are that engine's job.

Nothing here imports `workflow` — `'use step'` is a directive its compiler reads, and without that
compiler the directive is inert and `runNotebookStep` is an ordinary async function. So this package
declares no dependency on it, not even a peer one: install
[`workflow`](https://www.npmjs.com/package/workflow) (>= 4) alongside it if you want durability, and
nothing is imposed on consumers who do not.

Two deliberate choices:

- **The token is read from the environment inside the step**, not passed as an argument, so the
  credential stays out of the workflow's arguments and therefore out of its event log.
- **`maxRetries` is 0.** A notebook may write files, mutate databases, or spend model budget;
  repeating that implicitly is not a safe default. A consumer who has made a notebook idempotent can
  wrap it in their own step with whatever policy they want.

This is a server-side concern by definition — a durable engine needs a process that outlives a page —
which is why it is a separate entry point from the rest of the package.

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
