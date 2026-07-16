# @deepnote/local-runner

Run a `.deepnote` notebook with **edited inputs** — locally against a Python backend, or in
**Deepnote Cloud** — and (optionally) serve it to a static web page.

Built on the committed primitives: `@deepnote/blocks` (parse + input-block schemas),
`@deepnote/runtime-core` (`ExecutionEngine`), and `@deepnote/convert` (snapshots).

## Requirements

Execution needs a Python environment with [`deepnote-toolkit[server]`](https://pypi.org/project/deepnote-toolkit/)
installed. Parsing, input coercion, snapshot building, **reading and viewing snapshots**, and the
static server all work without it.

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
to fail instead. `serveStatic` exposes it at `POST /api/run-cloud`.

The first run of a new notebook is the slow one — blocks are created one API request each — and
`onCreateProgress` reports that. Later runs find the notebook by name and skip straight to running.

### Serve it to a static page

```ts
import { serveStatic } from "@deepnote/local-runner";

const { port, close } = await serveStatic({
  dir: "./public", // your index.html + assets
  notebookPath: "examples/6_with_inputs.deepnote",
});
// GET  /api/info       -> { notebook, inputs }    (input blocks, to build controls)
// POST /api/run        -> { inputs } -> { outputs, summary, snapshotYaml }
// POST /api/run-cloud   -> { inputs } -> runs it in Deepnote Cloud (needs DEEPNOTE_TOKEN)
// any other GET         -> a file from `dir` (path-traversal guarded)
await close();
```

Deliberately minimal: binds to `127.0.0.1`, no WebSocket, no watch, no rendering. Bring your own
page — or, to _view_ an existing snapshot rather than run one, read it directly (below); that needs
no server at all.

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
