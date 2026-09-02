# A pipeline as a script

A pipeline as a script: fan out across regional notebooks, gate on their structured results, and
report. About 40 lines.

```bash
DEEPNOTE_TOKEN=… NA_NOTEBOOK_ID=… EU_NOTEBOOK_ID=… APAC_NOTEBOOK_ID=… pnpm example:pipeline
```

The point of the example is that the _pipeline_ is not Node-specific. `runPipeline` runs every step
as an HTTP call to Deepnote, so the callback below runs unchanged in a browser page with no server
behind it.

The bootstrap is Node and would be replaced in a browser: this script reads `DEEPNOTE_TOKEN` and the
notebook ids from the environment via `process`, whereas a page gets its token from the Deepnote
shell and its configuration from the URL. What Node adds here is a shell, not a capability.

Notebooks are named by id and must already exist: running a pipeline needs permission to run a
notebook, not to create one.

Each regional notebook should end by emitting a JSON object the gate can read:

```python
import json

print(json.dumps({"region": region, "revenueK": 812.4, "qualityScore": 0.97}))
```

`outputs.lastJson(step)` reads that back without depending on block ids, which Deepnote reassigns
when it creates a notebook.
