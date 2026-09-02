# @deepnote/pipelines

Compose Deepnote notebook runs into pipelines. No server, no kernel, no orchestration engine.

```bash
pnpm add @deepnote/pipelines
```

## Start a run, wait for it, use its result

```ts
import { Deepnote, outputs } from "@deepnote/pipelines";

const deepnote = Deepnote.fromEnv(); // DEEPNOTE_TOKEN, optionally DEEPNOTE_API_URL

const extract = deepnote.notebooks.define({
  id: "nb-extract",
  outputs: {
    datasetUri: outputs.text("uri-block"),
    rowCount: outputs.json<number>("stats-block", "row_count"),
  },
});

// Starting and waiting are separate, because they are separate in the API.
const run = await extract.run({ inputs: { region: "eu", months: 6 } });
console.log(run.id); // the run continues in Deepnote whether or not this process does

const result = await run.wait({ onStatus: (status) => console.log(status) });
result.values.datasetUri; // string
result.values.rowCount; // number
```

`runAndWait()` is those two steps when you want them together. A failed run throws
`DeepnoteRunError` carrying the result — the snapshot is usually the only record of what the failing
block actually said — and `allowFailure: true` returns it instead. `wait({ timeoutMs })` throws
`DeepnoteRunTimeout` when the deadline passes first; only the watching stopped, the run continues in
Deepnote, and `deepnote.getRun(id)` picks it up again.

`extract.runs({ pageSize, pageToken })` is one page of the notebook's run history, newest first,
including runs started from Deepnote's UI; the page's `nextPageToken` fetches the next one.

### A pipeline is just a function

There is no workflow API to learn for the common case. `await` sequences, `Promise.all` fans out,
`if` branches, `try/catch` handles failure:

```ts
const [customers, products] = await Promise.all([
  deepnote.notebooks.ref("nb-customers").runAndWait({ inputs: { date } }),
  deepnote.notebooks.ref("nb-products").runAndWait({ inputs: { date } }),
]);

if (customers.values.rowCount > 1_000_000) {
  await deepnote.notebooks.ref("nb-partition").runAndWait();
}
```

Deepnote does not interpret that function; JavaScript does. Which means the same code runs from
cron, GitHub Actions, a Lambda, a FastAPI route, a CLI, Temporal, Airflow, or another Deepnote
notebook, and Deepnote competes with none of them. What the SDK adds is the remote operation being
awaitable, typed, and named — not a runtime that owns your control flow.

Reach for `runPipeline` (below) when you want what a plain function does not give you: the execution
graph, an event stream, and control nodes that make a local gate visible.

### Named outputs are a client-side contract

Inputs are symmetrical already: `POST /v2/runs` takes values keyed by the notebook's input-block
names. Outputs are not — a finished run is a snapshot of blocks, and only the author knows which
block holds the answer. So `outputs.text()`, `outputs.json()` and `outputs.lastJson()` declare that
mapping on the client, and the error names your binding rather than a block id you never typed:

```
Output "euShare" could not be read from totals.eu of block "stats-block" of run run-42: …
```

`outputs.lastJson()` is the one to prefer for a notebook Deepnote created from a file, since
Deepnote reassigns block ids on creation. If Deepnote later grows a server-side notion of named
outputs, this surface does not change — only the resolver behind it does.

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

## Define a pipeline in a `.deepnote` file

`runPipeline` puts the pipeline in application code. A pipeline can instead live in a file: the
notebook marked `isPipeline: true`, whose `notebook-function` blocks each name an external notebook,
the inputs to run it with, and the values it publishes.

The encoding is the one deepnote.com stores for a notebook-function block, so the same file means
the same thing in the product and here. An input is `{ variable_name }` — a pipeline variable — or
`{ custom_value }` — a literal. An export is `{ enabled, variable_name }`.

```yaml
notebooks:
  - id: pipeline
    name: Sales review
    isPipeline: true
    blocks:
      - id: analyze-europe
        type: notebook-function
        metadata:
          function_notebook_id: nb-regional
          function_notebook_inputs:
            region: { custom_value: Europe }
            trailing_months: { custom_value: "6" }
          function_notebook_export_mappings:
            summary_json: { enabled: true, variable_name: europe }

      - id: aggregate
        type: notebook-function
        metadata:
          function_notebook_id: nb-aggregate
          function_notebook_inputs:
            europe_json: { variable_name: europe }
            north_america_json: { variable_name: northAmerica }
```

```ts
import { runPipelineFile, planPipeline } from "@deepnote/pipelines";

const { value, plan, graph, skipped, failed } = await runPipelineFile(file, {
  token,
  onEvent,
});
```

**Dependencies are never declared twice.** A step reading `{ variable_name: europe }` depends on
whichever step exports `europe`, so regional steps that read nothing from each other are independent
_by construction_ and run concurrently. `planPipeline(file)` returns that graph without running
anything, so a UI can draw the pipeline before it starts.

A variable is referenced by name only — no paths, no templating. Reading a field belongs in a
`run_if` condition; a step that needs a field of another step's result should have that field
exported. A step's exports are read from the JSON object that ends its output, so they survive
Deepnote reassigning block ids; the last block's output must end with a JSON object, and anything
printed before it on earlier lines is ignored. Deepnote input blocks take strings, booleans and lists
of strings, so a structure that must cross into a notebook is exported as a JSON string. The runs API
rejects arrays for text inputs, so a fan-out's collected list can only feed an `input-select` block
with `deepnote_allow_multiple_values: true`.

**The pipeline notebook is interpreted, not executed.** Deepnote's block engine runs blocks strictly
in order, so handing it the parent would serialize the fan-out into one run with one status. Reading
it as a manifest keeps concurrency and per-step events, while the definition still lives in a
versioned, reviewable file.

Errors a graph can be checked for are raised at plan time, before anything runs: no notebook marked
`isPipeline` (or more than one), a variable no step exports, two steps exporting the same variable, a
step naming no notebook, a variable reference that is a path, a `for_each_as` without a `for_each`
or that shadows an export, a malformed condition, and a dependency cycle.

### Gates: `function_notebook_run_if`

A step's _existence_ can depend on an earlier result, so a gate lives in the file too:

```yaml
- id: final-arbiter
  type: notebook-function
  metadata:
    function_notebook_run_if: gptDecision != claudeDecision
    function_notebook_id: nb-arbiter
```

The condition reads pipeline variables, so the step depends on what it consults without that being
written down twice — even when no input mentions them. When it is false the step is skipped, and so
is anything that reads what it would have exported: a dependent is never run with a value that will
never arrive. Skipped steps come back in `result.skipped`, and each gate appears in the graph as a
`gate` node between the steps it reads and the step it governs.

The condition language is deliberately **not JavaScript**: a pipeline definition is data, and a file
that runs arbitrary code in whoever opens it is a different and much worse thing than a file that
describes a graph. There is no `eval`, no calls, no assignment, and no prototype access — property
lookups are own-properties only. It supports comparisons (`< <= > >= == !=`), `&& || !`, parentheses,
numeric indexing, and literals. A malformed condition fails at plan time.

One rule for every comparison operator: when both operands are numbers or numeric strings they
compare numerically (`"6" == 6`, `"6" < 10`), otherwise strictly (`"a" == 6` is false). `==` also
treats an absent value as `null`, so a gate can ask whether an earlier step published anything
(`recovered == null`); a variable whose producer was skipped reads as absent.

### Dynamic fan-out: `function_notebook_for_each`

A step's _width_ can come from the data rather than the file — one run per element, all concurrent:

```yaml
- id: recover
  type: notebook-function
  metadata:
    function_notebook_for_each: belowThreshold # a pipeline variable holding an array
    function_notebook_for_each_as: region # each element is bound to this name
    function_notebook_run_if: region.qualityScore < 0.95 # evaluated per element
    function_notebook_inputs:
      region: { variable_name: region } # the element, passed as an input
    function_notebook_export_mappings:
      summary_json: { enabled: true, variable_name: recovered }
```

`run_if` on a fan-out is evaluated per element, so this is conditional recovery: one run for each
region that failed the gate, and none at all when they all passed. Exports collect into an array in
element order, so `recovered` is the list of what actually ran.

**A fan-out always publishes a list, even when it ran nothing** — an empty array and every element
being gated off both give `[]` rather than a skip. A `for_each` over a variable that never arrived
skips the step, like any other missing value. A `for_each` over something that is not an array, or
over more than 50 elements, is a run-time error naming the step. Fan-out runs count towards the
engine's concurrency like any other step.

The fan-out also appears in the graph as a single `join` node its runs converge on, so a later step
can depend on it by name. The loop variable is bound by the step, so it is not a dependency on
anything; the step depends on the array and on whatever its other inputs and condition consult.

### Optional values: `fallback`

An input can name what to use when its variable never arrives because the producer was skipped (or
failed with `allow_failure`):

```yaml
claude_review_json:
  variable_name: claudeReview
  fallback: { custom_value: "" }
data:
  variable_name: recovered
  fallback: { variable_name: original }
```

A fallback is itself an input, so it may chain. This is what keeps a gate from poisoning everything
downstream: without it a step reading a value from a gated step is skipped whenever that gate was
false — correct, but it cascades. A step is skipped only when an input has _no_ satisfiable
alternative, and it depends on every alternative, since which one wins is a run-time fact.

### Tolerated failures: `function_notebook_allow_failure`

By default a failed notebook fails the pipeline (`PipelineStepError`). With
`function_notebook_allow_failure: true` the failed result is returned instead and the run continues;
the step is listed in `result.failed`, publishes nothing, and dependents fall back or are skipped.
On a fan-out, exports collect from the elements that succeeded. This covers every way a step can
fail — including a poll timeout or an API error — so one hung run in a fan-out does not discard the
rest; the result's `status` and `error` say what happened, and a timed-out run's `runId` is on it.

A run that finishes but whose exports cannot be read — no JSON object ends its output, or the object
lacks an exported key — counts as a failed step too: under `allow_failure` it is listed in `failed`
and publishes nothing, and without it the pipeline fails with a `PipelineStepError` naming the step
rather than a bare error. A terminal step marked `allow_failure` therefore lets the run resolve with
every other variable present.

### What is still code

`runPipeline` remains the answer for logic that is genuinely computation rather than topology:
reshaping or merging results between steps, retry policies with backoff, and anything that needs a
library. A file describes a graph — its steps, their gates, and their width — and that is the
boundary worth keeping.

See [`examples/pipelines/sales-pipeline.deepnote`](../../examples/pipelines/sales-pipeline.deepnote)
and the conformance fixtures in
[`test-fixtures/pipeline-conformance`](../../test-fixtures/pipeline-conformance), which are the
contract every implementation of this encoding must meet.

## When a step fails

A failed notebook rejects the pipeline with `PipelineStepError` unless the step has
`allowFailure: true`, in which case its failed result is returned and the callback decides what to
do. `allowFailure` covers every way a step can fail — a notebook that finished with an error status,
a poll that timed out, a transport or API error, a run that produced no snapshot — and the returned
result's `status` and `error` say which: `status` is Deepnote's run status when the notebook
finished, `'timeout'` when the executor stopped waiting for it, and `'error'` otherwise. A timed-out
run may still be executing in Deepnote; its `runId` is on the result.

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

`runPipelineFile` attaches the file runner's state as well: the error carries `variables`, `skipped`
and `failed` as they stood when the run stopped, alongside `partial`, so a caller can render every
value that did arrive next to the step that stopped the run.

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
