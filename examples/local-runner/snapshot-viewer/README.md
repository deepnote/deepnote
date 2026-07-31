# snapshot-viewer

A static page that renders a `.deepnote` snapshot as a report — a metadata header, the input values
the run used, and the outputs (KPI, table, chart, and an agent readout). **No server, no Python, no
kernel.** A snapshot already contains its outputs, so viewing one is just parsing.

The page parses the snapshot with `@deepnote/local-runner/snapshot-reader` and lays it out: headings
and outputs are prominent; block source sits behind a collapsed "code" disclosure. Copy it and change
what you like — the rendering lives here, not in the library.

## Try it

```bash
pnpm example:snapshot-viewer
# open the printed http://127.0.0.1:<port>
```

That builds the reader and serves everything from source — no copy steps. It renders
[`../../snapshot-showcase.snapshot.deepnote`](../../snapshot-showcase.snapshot.deepnote), which
includes an **agent block with precomputed output**, so you see agent-block support without running
an agent. Point it at a different snapshot with `?snapshot=<url>`.

[`serve.mjs`](./serve.mjs) wires up the three files a shared copy would contain: `index.html`, the
built `snapshot-reader.js`, and the sample snapshot.

## Share it

To hand someone a self-contained copy, put three files in one directory and serve it anywhere static
(GitHub Pages, S3, Netlify, `python3 -m http.server`):

```bash
pnpm --filter @deepnote/local-runner build
cp ../../../packages/local-runner/dist/snapshot-reader.iife.js ./snapshot-reader.js
cp <a-run>/snapshots/*_latest.snapshot.deepnote ./snapshot.deepnote
```

Whoever opens it needs a browser and nothing else. Re-running the notebook rewrites
`*_latest.snapshot.deepnote`, so a refresh shows the new outputs — the page reads the file, it
doesn't bake it in.

## Notes

- **Opening `index.html` directly over `file://` won't auto-load the snapshot** — browsers block
  `fetch` of sibling files, so the page falls back to a file picker. Serving over HTTP (above) avoids
  this.
- **HTML outputs render in a null-origin `sandbox`** (no `allow-same-origin`), so a shared snapshot
  can never run script in the page of whoever opens it. `allow-scripts` is used only to let each
  frame report its height. Images and tables render normally; script-driven interactive outputs won't
  be interactive.
- The reader bundle is ~72 kB gzipped, most of which is the YAML parser and the schemas.
