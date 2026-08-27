# orchestration

A pipeline as a script: fan out across regional notebooks, gate on their structured results, and
report. About 40 lines.

```bash
DEEPNOTE_TOKEN=… NA_NOTEBOOK_ID=… EU_NOTEBOOK_ID=… APAC_NOTEBOOK_ID=… pnpm example:orchestration
```

The point of the example is that none of it is Node-specific. `orchestrate` runs every step as an
HTTP call to Deepnote, so the same pipeline runs unchanged in a browser page with no server behind
it — see [`run-app`](../run-app). What Node adds here is a shell, not a capability.

Notebooks are named by id and must already exist: running a pipeline needs permission to run a
notebook, not to create one.

Each regional notebook should end by emitting a JSON object the gate can read:

```python
print(json.dumps({"region": region, "revenueK": 812.4, "qualityScore": 0.97}))
```

`outputs.lastJson(step)` reads that back without depending on block ids, which Deepnote reassigns
when it creates a notebook.
