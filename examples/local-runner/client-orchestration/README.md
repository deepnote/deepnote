# client-orchestration

A multi-notebook pipeline — regional fan-out, a quality gate, a final arbiter — that runs entirely
in the browser. No application server, no local kernel, no long-lived token.

This is the same orchestration engine [`run-app`](../run-app) uses. Only the step executor differs:
there, steps run through a Node process; here they run through `fetch` against Deepnote Cloud.

```js
const { orchestrateInCloud } = DeepnoteOrchestrator

await orchestrateInCloud(
  async ({ run, control, outputs }) => {
    const regions = await Promise.all(
      REGIONS.map((region) => run({ id: region.name, notebookId: region.notebookId, inputs: { ... } }))
    )
    const failing = await control({ id: 'quality-gate', kind: 'gate' }, () => /* plain JS */)
    return run({ id: 'final-arbiter', notebookId: ARBITER, dependsOn: ['quality-gate'], concluding: true })
  },
  { token, baseUrl, onEvent }
)
```

The workflow callback is identical to the Node one: `Promise.all`, `filter`, and a conditional
rerun are the pipeline. The engine records what happened and streams events; it does not define a
workflow language.

## What having no server costs

Two constraints follow, and both are enforced rather than left to discover at runtime:

- **Notebooks must already exist.** Steps name a `notebookId`. There is no `createIfMissing`,
  because a viewer-scoped token may run a notebook, not create one. Pre-create them in Deepnote.
- **There is no local target.** A browser has no Python kernel, so a step asking for `target:
'local'` fails with that explanation instead of quietly running somewhere else.

Everything else — the graph, dependency edges, gates, `allowFailure`, the output helpers
(`lastJson`, `lastAgentText`) — behaves exactly as it does in Node.

## Tokens

Published and opened from Deepnote, the page asks the embedding shell over `postMessage` and uses
the short-lived, project- and viewer-scoped token it gets back. The shell names the API origin in
the same reply, and the token is only ever sent to that origin — the token and origin are one
credential bundle. No `DEEPNOTE_TOKEN` is embedded in the page.

## Run it locally

```bash
pnpm example:client-orchestration
```

That builds the package and starts a **static file server** — it has no API routes and runs no
notebooks; it exists so `./orchestrator.js` resolves without a copy step. Then open the printed URL
with your notebook ids and a token:

```text
http://127.0.0.1:<port>/?token=…&naNotebookId=…&euNotebookId=…&apacNotebookId=…&arbiterNotebookId=…
```

A `?token=` is for local testing only. Published, the shell supplies one and the query parameter is
unnecessary.

Each regional notebook should end by emitting a JSON object the gate can read, for example:

```python
print(json.dumps({"region": region, "revenueK": 812.4, "qualityScore": 0.97}))
```

`outputs.lastJson(step)` reads that back without depending on block ids, which Deepnote may reassign.
