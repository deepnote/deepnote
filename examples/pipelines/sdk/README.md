# A pipeline with no pipeline API

The same fan-out-and-gate as [`../script`](../script), written with the client instead of
`runPipeline`. About 30 lines of ordinary JavaScript.

```bash
DEEPNOTE_TOKEN=… NA_NOTEBOOK_ID=… EU_NOTEBOOK_ID=… APAC_NOTEBOOK_ID=… pnpm example:pipeline-sdk
```

The point of this example is what is missing from it. There is no workflow object, no step
registry, no graph to declare: `Promise.all` fans out, `filter` gates, `await` sequences. JavaScript
executes the pipeline, and the SDK only makes each remote operation awaitable, typed, and named.

That is also the trade. Because the coordination lives in this process, it is not durable: kill the
script mid-run and the notebook runs continue in Deepnote — they are detached, and their ids are
printed — but nothing aggregates them and no gate fires. Pick this up again with
`deepnote.getRun(id)`, or reach for one of the durable options in the
[package README](../../../packages/pipelines/README.md).

Compared with [`../script`](../script), what you give up is the execution graph and the event
stream. `runPipeline` records both; a plain function records neither, because nothing is watching.
Callers who want the graph and event stream import `runPipeline` from `@deepnote/pipelines` directly.
