# Snapshot viewer

A static page that renders a `.deepnote` snapshot — code, outputs, charts, and the input values the
run used. **No server, no Python, no kernel.** A snapshot already contains the outputs, so viewing
one is just parsing.

The page (~60 lines of plain JS) parses the snapshot with
`@deepnote/local-runner/snapshot-reader` and renders it. Copy it and change what you like — the
rendering lives here, not in the library.

## Try it

From this directory:

```bash
# 1. The snapshot reader (the YAML parser and the Deepnote schemas, in one file)
pnpm --filter @deepnote/local-runner build
cp ../../packages/local-runner/dist/snapshot-reader.iife.js ./snapshot-reader.js

# 2. Any snapshot — e.g. one `deepnote run` wrote next to a notebook
cp ../../my-project/snapshots/*_latest.snapshot.deepnote ./snapshot.deepnote

# 3. Serve the directory
python3 -m http.server 8000    # or: npx serve .
```

Open <http://localhost:8000>. The page reads `./snapshot.deepnote` on load. To point it at a
different file: `?snapshot=other-run.deepnote`.

## Share it

The directory is now fully static — `index.html`, `snapshot-reader.js`, `snapshot.deepnote`. Drop it
on any static host (GitHub Pages, S3, Netlify) or zip it and send it. Whoever opens it needs a
browser and nothing else: no Deepnote install, no Python, no kernel.

Re-running the notebook rewrites `*_latest.snapshot.deepnote`, so refreshing the page after a new
run shows the new outputs — the page reads the file, it doesn't bake it in.

## Notes

- **Opening `index.html` directly with `file://` won't auto-load the snapshot.** Browsers block
  `fetch` of sibling files from `file://`, so the page falls back to a file picker — choose the
  snapshot and it renders. Serving over HTTP (above) avoids this.
- **HTML outputs render in a sandboxed iframe with scripts disabled.** A snapshot you share should
  not be able to run script in the page of whoever opens it. The trade-off is that script-driven
  interactive outputs (e.g. Plotly) won't be interactive; images and tables render normally.
- **Markdown blocks render as text.** Rendering them would mean shipping a markdown parser into the
  page, for a viewer whose job is showing outputs.
- The bundle is ~72 kB gzipped, most of which is the YAML parser and the schemas.
