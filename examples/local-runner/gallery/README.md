# gallery — static notebook outputs, five frontends

```bash
pnpm example:gallery
# open the printed http://127.0.0.1:<port>
```

Four static pages reinterpret the same `snapshot-showcase.snapshot.deepnote`. A fifth replays a
real, seven-notebook cloud pipeline from the immutable snapshot captured at every step.

|                                   | argues                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| [**dashboard**](./dashboard.html) | the snapshot as **product-ready metrics** — recomputes its own KPIs, no notebook in sight |
| [**explorer**](./explorer.html)   | the snapshot as a **structured dataset** — sortable columns, dtypes, distributions        |
| [**deck**](./deck.html)           | the snapshot as **presentation data** — one idea per slide, click or arrow keys           |
| [**terminal**](./terminal.html)   | the snapshot as a **plain-text log** — ASCII bars instead of the PNG                      |
| [**pipeline**](./pipeline.html)   | snapshots as an **execution graph** — inspect each step or open its Deepnote run          |

## Pipeline replay

The pipeline page is a fully static record of the orchestration demo in
[`../run-app`](../run-app). It renders a completed execution left to right:

```text
inputs ─┬─ North America ─┐
        ├─ Europe ────────┼─ quality gate ─┬─ Europe recovery ─┐
        └─ Asia Pacific ──┘                └───────────────────┴─ portfolio ─┬─ GPT-5.5 ─────────┐
                                                                            └─ Claude Sonnet 5 ─┴─ final arbiter
```

This is not mocked workflow state. [`pipeline.json`](./pipeline.json) records the real topology,
timings, run IDs and Deepnote URLs from one cloud execution. `pipeline-snapshots/` contains the
seven exact `.deepnote` snapshots returned by that execution. The concluding arbiter is selected by
default; selecting any notebook node renders that step's snapshot below the graph, while its `↗`
link opens the corresponding notebook's run history in Deepnote. Local control-flow stages remain
visible but are deliberately not links because they are JavaScript decisions, not notebook runs.

The static capture demonstrates the separation the orchestration API is built around: local code
owns branching and joins; Deepnote Cloud executes the notebook and agent steps. Replaying the result
needs no token, server, kernel or AI provider key.

## The point

`@deepnote/local-runner`'s browser entry exports exactly two functions and three types, and says
rendering is deliberately excluded: _"a DOM renderer is a page concern"_. The
[snapshot-viewer](../snapshot-viewer) is one answer to that — a snapshot as a **read-only notebook
document**. It reads like the only answer. It isn't.

The sharper claim is that **a snapshot is data, not a picture of a notebook**. The dashboard proves
it by refusing the easy route: the notebook already baked its KPI cards into `text/html`, and the
dashboard ignores them. Instead it computes:

```
revenue    = Σ dataframe.rows['Revenue ($k)'] × 1000            → $6,572,100
target     = target_revenue_k × trailing_months × 1000          → $6,000,000   (both are run inputs)
attainment = revenue / target                                   → 109.5%
top region = the row with the most revenue                       → North America
```

Those come out of `application/vnd.deepnote.dataframe.v3+json` and the values the run executed with.
They match the numbers the notebook rendered — which is the only reason to trust the exercise.

**On 109.5% vs 110%:** the notebook's own card says `110%`, because its Python formats with
`{pct:.0f}`. The true value is `6572.1 / 6000 = 109.535%`, which these pages show to 1dp. Same
number, different precision — not a bug, and not worth "fixing" in either direction.

**What isn't recomputed, on purpose:** the notebook's card also shows `▲ 13.7% vs prior period`. The
dataframe holds only the _current_ window's rows; the prior window was never written to an output, so
it exists nowhere in structured form. The dashboard omits it rather than inventing it. That's the
honest edge of "snapshots are data" — you get what the notebook materialized, not every scalar it
held in memory.

## No iframes here

`snapshot-viewer` injects the notebook's `text/html` into an iframe sandboxed at null origin, because
that HTML is untrusted and must not touch the page. These pages never inject it, so that surface
doesn't exist. Every snapshot-derived string — agent output, stream text, dataframe cells, input
values — reaches the DOM through `textContent`. `innerHTML` appears only for static markup written in
this repo.

Not a criticism of the viewer: it's showing you the notebook, so it has to render what the notebook
drew. These pages are asking the data questions instead, and get to skip the problem.

## The gap this exposed — and closed

Building the original four views found one real hole, which is the other half of why they exist.

`SnapshotBlock.input` used to carry `{ name, value }`, and `toSnapshotView` dropped block `metadata`.
So a page could say `trailing_months = 6` but not "Trailing months · 6 of 3–12" — and a value without
its bounds is a variable dump, not a UI. Every one of those four pages wanted the same thing; the
dashboard's filter bar and the terminal's `[3–12]` are what it looked like when they couldn't have it.

The information was never missing from the library. `listInputBlocks` already returned exactly the
right shape — `label`, `options`, `multiple`, `min`, `max`, `step` — under a docstring reading
_"metadata a UI needs to render an editable control"_. `run-app` gets all of it over `/api/info`. A
browser got `{ name, value }`. **Gated by entry point, not by capability** — and the extraction is
pure metadata reading with no Node dependency in its chain, so nothing but the export list stood in
the way.

Fixed on this branch: the per-block read moved to `input-info.ts`, `listInputBlocks` and
`toSnapshotView` both call it, and `SnapshotBlock.input` now carries the same fields. `listInputBlocks`'
own tests were not touched — that's what proves the refactor changed nothing for existing callers.

**Still open:** the agent's model. `deepnote_agent_model` lives in block `metadata`, which a
`SnapshotBlock` still doesn't expose — which is why [snapshot-viewer](../snapshot-viewer) hardcodes
`'precomputed output'` instead of reading it. Exposing input metadata was a contained change with
four consumers asking for it; exposing arbitrary block metadata is a wider question about what the
view is for, and one demo isn't enough to answer it.

## Reading the code

- `gallery.js` — the shared bit, deliberately small: _finding_ things in a snapshot (which output
  holds the dataframe, what did the agent say, what were the inputs). Fiddly enough to be worth
  sharing — nbformat values are `string | string[]`, base64 arrives folded across YAML lines — and
  the sort of thing multiple pages would otherwise get subtly different.
- Each page owns its _showing_. They share CSS idioms and some markup shape; that duplication is
  deliberate, so each page reads standalone. Only the parsing is centralized.
- `serve.mjs` — a hardcoded route table, no directory serving. Convenience only: every page remains
  deployable as static files. The four single-snapshot pages also work opened straight off disk,
  where a browser blocks `fetch` of a sibling file and they fall back to a file picker.

## Deploying one

Any static host. For a single-snapshot view, copy the page (renamed `index.html`), `gallery.js`,
`snapshot-reader.js` from `packages/local-runner/dist/snapshot-reader.iife.js` (~70 kB gzipped,
everything inlined), and a `snapshot.deepnote`. For the pipeline view, copy `pipeline.html`,
`pipeline.json`, `gallery.js`, the reader, and `pipeline-snapshots/`. No application server, build,
Python or credentials are required.
