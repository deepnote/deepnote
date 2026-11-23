# Fast data apps (prototype)

An experiment in generating data apps in seconds instead of ~90s. The model writes a short
app spec (one line per component) instead of a hand-written page; a pre-built runtime renders
each line the moment it streams in.

- `runtime/`: the renderer (`app-kit.js`), spec format and validator (`spec.js`), safe expressions
  and templates (`expr.js`), data profiling (`data.js`), and the studio page (`studio.html`).
- `prompt/system.md`: the spec catalogue the model gets.
- `bench/`: the generators and tools. `outline.mjs` is outline-first parallel generation (the model
  outlines the page; each section is written by its own call as its outline line arrives).
  `parallel.mjs` and `generate.mjs` are the earlier planner-driven and single-stream versions.
- `snapshots/`: stored outputs of the Lindquett example notebooks; `sources.json` points at them.

## Run the studio

```bash
pnpm build                                        # from the repo root, once
node prototypes/fast-data-apps/bench/capture-snapshots.mjs   # builds the notebooks "Run notebooks" uses
node prototypes/fast-data-apps/bench/studio.mjs   # http://127.0.0.1:8800
```

Generation calls the model through the `claude` CLI. "Run notebooks" needs Python with
`deepnote-toolkit[server]`.
