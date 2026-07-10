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
    { persistSnapshot: true }, // writes a sibling snapshots/*.snapshot.deepnote (path inputs only)
  );

for (const { blockId, outputs } of outputs) {
  // outputs are raw Jupyter IOutput objects, in execution order
}
```

- Input values are **coerced** to each block's schema shape for the persisted file (e.g. a
  slider becomes a string), while the **raw native** values are injected into the kernel.
- A failing block is reported via `summary.failedBlocks` — it is **not** thrown. Only
  infrastructure/config errors throw (no Python env, missing toolkit, an invalid file, or
  `persistSnapshot` on a non-path input).

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
