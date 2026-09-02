# A pipeline in Python

The same fan-out-and-gate as [`../script`](../script) and [`../sdk`](../sdk), in Python.

```bash
python -m pip install deepnote-sdk
DEEPNOTE_TOKEN=… NA_NOTEBOOK_ID=… EU_NOTEBOOK_ID=… APAC_NOTEBOOK_ID=… \
  python3 examples/pipelines/python/pipeline.py
```

The point of the example is what is missing from it. There is no workflow object, no step registry,
no DAG to declare: `asyncio.gather` fans out, a comprehension gates, `await` sequences. Python
executes the pipeline, and the SDK only makes each remote operation awaitable, typed, and named.

Two details worth reading in the source:

- **A failed notebook is an outcome, not an SDK error.** `gather(..., return_exceptions=True)` lets
  every region finish, and `DeepnoteRunError` carries the whole result, so the handler can print what
  the failing block actually said.
- **`outputs.last_json()` names no block id.** Deepnote reassigns block ids when it creates a
  notebook from a file, so a binding that names one is fragile in exactly that case.

And the trade: because coordination lives in this process, it is not durable. Kill the script
mid-run and the notebook runs continue in Deepnote — they are detached, and their ids are printed —
but nothing aggregates them and no gate fires. Pick one back up with `deepnote.runs.get(id)`, or use
one of the durable options in the [package README](../../../packages/pipelines/python/README.md).
