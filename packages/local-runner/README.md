# @deepnote/local-runner

Run a `.deepnote` notebook with **edited inputs** against a **local** Python backend, and
(optionally) serve it to a static web page. Local execution only — no cloud.

Built on the committed primitives: `@deepnote/blocks` (parse + input coercion),
`@deepnote/runtime-core` (`ExecutionEngine`), and `@deepnote/convert` (snapshots).

## Requirements

Execution needs a Python environment with [`deepnote-toolkit[server]`](https://pypi.org/project/deepnote-toolkit/)
installed. Parsing, input coercion, snapshot building, and the static server work without it.

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
- Input values are **coerced** to each block's schema shape for the persisted file (e.g. a
  slider becomes a string), while the **raw native** values are injected into the kernel.
- A failing block is reported via `summary.failedBlocks` — it is **not** thrown. Only
  infrastructure/config errors throw (no Python env, missing toolkit, an invalid file).

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

Runs a notebook that **already exists in Deepnote** (open it in the cloud first to get its id) via
the runs API — trigger → poll → fetch snapshot — reusing the shared `@deepnote/cloud` client that
also powers `deepnote run --cloud`. Needs a `DEEPNOTE_TOKEN`. `serveStatic` exposes it at
`POST /api/run-cloud`.

### Serve it to a static page

```ts
import { serveStatic } from "@deepnote/local-runner";

const { port, close } = await serveStatic({
  dir: "./public", // your index.html + assets
  notebookPath: "examples/6_with_inputs.deepnote",
});
// GET  /api/info  -> { notebook, inputs }         (input blocks, to build controls)
// POST /api/run   -> { inputs } -> { outputs, summary, snapshotYaml }
// any other GET   -> a file from `dir` (path-traversal guarded)
await close();
```

Deliberately minimal: binds to `127.0.0.1`, no WebSocket, no watch, no rendering. Bring your
own page; a browser renderer is intentionally out of scope for this package.

## Testing

Unit tests mock `ExecutionEngine`. A real end-to-end test runs only when
`DEEPNOTE_TOOLKIT_PYTHON` points at a Python env with the toolkit installed:

```bash
DEEPNOTE_TOOLKIT_PYTHON=/path/to/venv pnpm --filter @deepnote/local-runner test
```
