# @deepnote/local-runner

Run a `.deepnote` notebook with **edited inputs** — locally against a Python backend, or in
**Deepnote Cloud** — and (optionally) serve it to a static web page.

Built on the committed primitives: `@deepnote/blocks` (parse + input-block schemas),
`@deepnote/runtime-core` (`ExecutionEngine`), and `@deepnote/convert` (snapshots).

## Requirements

Local execution needs a Python environment with [`deepnote-toolkit[server]`](https://pypi.org/project/deepnote-toolkit/)
installed. Cloud execution needs a `DEEPNOTE_TOKEN` instead. Parsing, input coercion, snapshot
building, **reading and viewing snapshots**, and the static server all work without either.

## Usage

### Run with input overrides

```ts
import { runWithInputs } from "@deepnote/local-runner";

const { outputs, summary, snapshot, snapshotYaml, snapshotPath } =
  await runWithInputs(
    "examples/6_with_inputs.deepnote", // a path, raw .deepnote YAML, or a DeepnoteFile object
    { greeting: "hi", count: 7, enabled: true }, // native values; coerced to schema shape internally
  );
// snapshotPath -> the sibling snapshots/*.snapshot.deepnote it just wrote

for (const { blockId, outputs } of outputs) {
  // outputs are raw Jupyter IOutput objects, in execution order
}
```

- By **default it writes a snapshot** next to a path input, like `deepnote run` (`snapshotPath`).
  Pass `{ persistSnapshot: false }` to skip; inputs without a path (YAML/object) are never persisted.
- Input values are **coerced** to each block's schema shape (e.g. a slider takes `7` or `'7'` and
  stores `'7'`), which is what lets a UI pass native control values where the CLI requires
  already-schema-shaped ones. That shape is how the value is **stored**, not what your code sees: the
  input block's generated Python is `months = 7`, so a slider reaches the kernel as an `int`. A text
  input stays a `str`, a checkbox becomes a real `True`/`False`.
- A failing block is reported via `summary.failedBlocks` — it is **not** thrown. Only
  infrastructure/config errors throw (no Python env, missing toolkit, an invalid file).

### Stream output live

Two callbacks deliver output incrementally instead of waiting for the whole run — a code block's
Jupyter outputs, and an agent block's token/reasoning/tool activity as the LLM produces it:

```ts
await runWithInputs(
  "notebook.deepnote",
  {},
  {
    onOutput: (blockId, output) => {
      // a code block's IOutput objects, streamed as the kernel emits them
    },
    onAgentEvent: (event) => {
      // agent blocks: { type: "text_delta" | "reasoning_delta" | "tool_called" | "tool_output", ... }
      if (event.type === "text_delta") process.stdout.write(event.text);
    },
  },
);
```

The final agent text still lands in the snapshot outputs; `onAgentEvent` is purely the live channel.

### Run in Deepnote Cloud (the second way)

```ts
import { runInCloud } from "@deepnote/local-runner";

const result = await runInCloud(
  "examples/6_with_inputs.deepnote", // resolves the cloud notebook id from the file
  { greeting: "hi", count: 7 }, // input overrides
  { token: process.env.DEEPNOTE_TOKEN }, // or pass an explicit notebookId
);
// result.status / result.success / result.outputs / result.snapshotYaml
```

Runs the notebook in Deepnote via the runs API — trigger → poll → fetch snapshot — reusing the shared
`@deepnote/cloud` client that also powers `deepnote run --cloud`. Needs a `DEEPNOTE_TOKEN`, and
nothing else: if the notebook isn't in Deepnote yet, this creates it there (project, notebook, blocks)
and runs it in the same call, reporting `created: true`. No browser step. Pass `createIfMissing: false`
to fail instead. `serveStatic` exposes it at `POST /api/run`, which is where runs go by default.

The first run of a new notebook is the slow one — blocks are created one API request each — and
`onCreateProgress` reports that. Later runs find the notebook by name and skip straight to running.

### Schedule recurring Deepnote Cloud runs

```ts
import { scheduleInCloud } from "@deepnote/local-runner";

const result = await scheduleInCloud(
  "examples/6_with_inputs.deepnote",
  "0 9 * * 1-5",
  {
    token: process.env.DEEPNOTE_TOKEN,
    timezone: "Europe/London",
  },
);
// result.schedule.nextRunAt / result.notebookId / result.viewUrl
```

This creates or updates the recurring schedule in Deepnote Cloud without running the notebook
immediately. If the project is missing, it is created first; pass `createIfMissing: false` to require
an existing cloud notebook. Deepnote has one schedule per project, so scheduling another notebook
from the same project re-points that schedule.

One file shape cannot be created this way: a project that declares an `initNotebookId`. The public
API can neither set nor read a project's init designation, so a created notebook would run without
its setup — at whatever hour the cron names, which is the least visible place to find out. Both
`scheduleInCloud` and `runInCloud` refuse rather than create it, in every case:

- a **new project** would be created without the designation;
- an **existing exact-name project** proves nothing, since only the target notebook is uploaded into
  it and the API will not say whether that project carries a designation — an unrelated project
  sharing the name would run the notebook without setup just the same;
- an **id that matches no notebook in the file** is the ordinary split-file shape, not an absent
  init: `splitByNotebooks` keeps `initNotebookId` in every main file so the sibling resolver can find
  the standalone init file.

Import such a project into Deepnote once, which keeps the designation, then run or schedule it —
that path creates nothing and so never refuses.

### Serve it to a static page

```ts
import { serveStatic } from "@deepnote/local-runner";

const { port, close } = await serveStatic({
  dir: "./public", // your index.html + assets
  notebookPath: "examples/6_with_inputs.deepnote",
  // runTarget: "local",  // omit for Deepnote Cloud
});
// GET  /api/info       -> { notebook, inputs, runTarget }  (input blocks, to build controls)
// POST /api/run        -> { inputs } -> { target, success, outputs, snapshotYaml, ... }
// POST /api/schedule-cloud -> { schedule: { frequency, time, ... }, timezone? } -> cloud schedule
// GET  /api/cloud-runs  -> { runs, viewUrl }       (for history/navigation)
// any other GET         -> a file from `dir` (path-traversal guarded)
await close();
```

One run endpoint, one runner, wherever the run happens. `runTarget` decides — `"cloud"` unless you
say otherwise, so a page needs one Run button rather than one per destination, and an app runs on
the Deepnote API without being configured for it. Set `"local"` only when there is a local Deepnote
kernel to run against instead; that path writes a snapshot next to `notebookPath` (like
`deepnote run`) unless `persistSnapshot: false`.

Both ends are adapted to a single `RunnerFn` — `(input, inputs, options) => Promise<RunResult>` —
so the route never branches and one `RunResult` describes either run. Every runner must include
`success`, or a local `summary` from which the server derives it; `runId`, `status`, `created`, and
`viewUrl` describe a cloud run and are simply absent from a local one. The response says which one ran via `target`, and
`GET /api/info` reports `runTarget` up front so a page can label its button without being told
separately.

`POST /api/schedule-cloud` accepts a reusable friendly cadence: `{ frequency: "daily", time }`,
`{ frequency: "weekly", dayOfWeek, time }` (Sunday = `0`), or
`{ frequency: "monthly", dayOfMonth, time }`. The server validates it and converts it to cron, so
custom frontends do not need scheduling logic. Advanced frontends can still send `{ cron }`
directly. Both forms accept `timezone` and `createIfMissing`; scheduling does not execute the
notebook.

The same conversion is available without the server:

```ts
import { resolveRecurringSchedule } from "@deepnote/local-runner";

resolveRecurringSchedule({ frequency: "weekly", dayOfWeek: 5, time: "17:45" });
// { cron: "45 17 * * 5", description: "Every Friday at 17:45" }
```

Cloud scheduling and execution may run concurrently. If the notebook does not exist yet,
`runInCloud` and `scheduleInCloud` coordinate creation inside the library: same-notebook calls share
one creation, while different notebooks in the same project serialize creation to avoid duplicate
projects. Frontends do not need their own creation lock.

What that shared creation writes is the file as it stands. A `runInCloud` call's input overrides are
sent with the run, not baked into the notebook it creates — otherwise a schedule that joined the
same creation would inherit that run's one-off arguments as its recurring defaults.

The server binds to `127.0.0.1` and provides no WebSocket, watch, or rendering. Bring your own page
— or, to _view_ an existing snapshot rather than run one, read it directly (below); that needs no
server at all.

### Orchestrate notebook pipelines

Run several notebooks as one pipeline — fan out, gate on the results, decide:

```ts
import { orchestrate } from "@deepnote/local-runner";

const { value, graph } = await orchestrate(
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
pipeline runs in a script, in CI, and in a browser page. Nothing reachable from `orchestrate`
imports `node:*`.

Notebooks are addressed by id and must already exist. Running a pipeline needs permission to run a
notebook, not to create one — which is what lets a page do it with a viewer's short-lived token.

`control` records a local decision as a node, so a gate or an aggregation shows up in the graph
instead of happening invisibly between steps. `outputs.lastJson(step)` and
`outputs.lastAgentText(step)` read a step's results without depending on block ids, which Deepnote
reassigns when it creates a notebook.

A failed notebook throws `OrchestrationStepError` carrying the result, so a caller can still show
how far the run got; `allowFailure: true` returns it instead.

`runOrchestration(workflow, options, executor)` is the same engine with the runner left open, for
callers that want to run steps somewhere else.

See [`examples/local-runner/orchestration`](../../examples/local-runner/orchestration).

### Define a pipeline in a `.deepnote` file

`orchestrate` puts the pipeline in application code. A pipeline can instead live in a file: a parent
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
import { orchestrateFile, planOrchestration } from "@deepnote/local-runner";

const { value, plan, graph } = await orchestrateFile(file, {
  token,
  onEvent,
});
```

**Dependencies are never declared twice.** A step reading `{{europe}}` depends on whichever step
exports `europe`, so the three regional steps above are independent _by construction_ and run
concurrently. This is the same variable-flow model the reactivity package already applies to
notebook-function blocks. `planOrchestration(file)` returns that graph without running anything, so
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

#### Gates: `run_if`

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

#### Dynamic fan-out: `for_each`

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

#### Optional values: `??`

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

#### What is still code

`orchestrate` remains the answer for logic that is genuinely computation rather than topology:
reshaping or merging results between steps, retry policies with backoff, and anything that needs a
library. A file describes a graph — its steps, their gates, and their width — and that is the
boundary worth keeping.

See [`examples/local-runner/sales-pipeline.deepnote`](../../examples/local-runner/sales-pipeline.deepnote).

### Make a pipeline durable

`orchestrate` holds its state in one process and is gone if that process is. That is the right trade
for a script or an interactive page, and the wrong one for anything scheduled or long-lived.

Rather than growing a checkpoint/resume layer — which is how orchestration libraries turn into bad
workflow engines — durability is delegated. `@deepnote/local-runner/workflows` exposes one notebook
run as a step you compose inside a [Workflow SDK](https://www.npmjs.com/package/workflow) function:

```ts
import { lastOutputJson } from "@deepnote/local-runner";
import { runNotebookStep } from "@deepnote/local-runner/workflows";

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

Replay, retries, timers, and observability are that engine's job. `workflow` is an **optional peer
dependency**: without its compiler the `'use step'` directive is inert and `runNotebookStep` is an
ordinary async function, so nothing is imposed on consumers who do not want it.

Two deliberate choices:

- **The token is read from the environment inside the step**, not passed as an argument, so the
  credential stays out of the workflow's arguments and therefore out of its event log.
- **`maxRetries` is 0.** A notebook may write files, mutate databases, or spend model budget;
  repeating that implicitly is not a safe default. A consumer who has made a notebook idempotent can
  wrap it in their own step with whatever policy they want.

This is a server-side concern by definition — a durable engine needs a process that outlives a page —
which is why it is a separate entry point from the rest of the package.

### Read a snapshot — no Python, no kernel

A snapshot is a `.deepnote` file with the outputs stored inline, so reading one is parsing, not
executing. `readSnapshot` needs no Python environment, no `ExecutionEngine`, and no toolkit:

```ts
import { readSnapshot } from "@deepnote/local-runner";

const view = readSnapshot("snapshots/sales_latest.snapshot.deepnote"); // a path, YAML, or an object

view.projectName; // "Sales"
view.finishedAt; // when the run completed
for (const block of view.notebooks[0].blocks) {
  block.type; // "code" | "sql" | "markdown" | "input-slider" | ...
  block.content; // the source
  block.outputs; // Jupyter IOutput[] — exactly what the run produced
  block.input; // for input blocks: { name, value } — the values this run used
}
```

Outputs are read from **every** executable block (code, SQL, visualization, big-number…), not just
code blocks. `parseSnapshot(yaml)` is the same thing without the filesystem, and is browser-safe.

### Share a snapshot as a static page

`@deepnote/local-runner/snapshot-reader` is the same parser as one self-contained browser bundle —
the YAML parser and the schemas in a single file a page can `<script>` in. A page can then read a
snapshot with no server, no Python and no kernel:

```html
<script src="./snapshot-reader.js"></script>
<script>
  const yaml = await (await fetch("./snapshot.deepnote")).text();
  const view = DeepnoteSnapshot.parseSnapshot(yaml);
  // render `view.notebooks[].blocks[]` however you like
</script>
```

Rendering stays in the page, as it does for `serveStatic` — how a table looks, and whether HTML
output is sandboxed, is a page decision, not a library one.
[`examples/local-runner/snapshot-viewer`](../../examples/local-runner/snapshot-viewer) is a complete page you can
copy: source, outputs, images, tables, and the input values that produced them.

To publish: put `index.html`, `snapshot-reader.js`, and your `*.snapshot.deepnote` in one directory
and serve it anywhere static (GitHub Pages, S3, `python3 -m http.server`). The reader needs a
browser and nothing else — no Deepnote, no Python, no kernel. Re-running the notebook rewrites
`*_latest.snapshot.deepnote`, so a refresh shows the new outputs.

The example renders HTML outputs in a **null-origin sandboxed iframe** (no `allow-same-origin`): a
snapshot you hand to someone else can't run script in your page. `allow-scripts` is enabled only so
each frame can report its height back for a clean fit. Opening the page from `file://` cannot
auto-fetch the snapshot (browsers block it), so it falls back to a file picker.

## Testing

Unit tests mock `ExecutionEngine`. A real end-to-end test runs only when
`DEEPNOTE_TOOLKIT_PYTHON` points at a Python env with the toolkit installed:

```bash
DEEPNOTE_TOOLKIT_PYTHON=/path/to/venv pnpm --filter @deepnote/local-runner test
```
