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

## PageMantle data

`pagemantle/` connects the studio to the [PageMantle company dataset](https://huggingface.co/datasets/deepnote/pagemantle-company-dataset)
(synthetic Stripe, HubSpot, analytics, Search Console, PostHog, Snowflake, BigQuery, Slack, calendar,
Linear and Notion data). Each file in `pagemantle/src/` is one notebook that reads the raw files with
DuckDB and outputs the tables apps use; `build.mjs` turns them into `.deepnote` notebooks and writes
`sources.pagemantle.json`. Each notebook has a `dataset` input: `sample` (fast, every 10th customer or
row) or `full`.

```bash
# Extract the dataset's archives into ~/data/pagemantle (or set PAGEMANTLE_DATA), then:
node prototypes/fast-data-apps/pagemantle/build.mjs --run    # build notebooks and run them on the sample
SOURCES=sources.pagemantle.json node prototypes/fast-data-apps/bench/studio.mjs --port 8801
```

In the studio, **Run on full dataset** reruns every notebook with `dataset=full` and shows the same
app on the results. `python3 pagemantle/try.py <notebook> [sample|full]` runs one notebook outside
Deepnote while developing it.

In an app, hover a component and click **Comment**: **Edit** changes that component in place, and
**Deep dive** builds a new app about it in a new tab. **Undo** steps back through earlier versions.
