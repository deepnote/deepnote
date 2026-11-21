---
title: "Playbook: a notebook as a backend for your other systems"
description: Call a Deepnote notebook from any system that can make an HTTP request, pass it inputs and read back structured results, so scoring, enrichment and calculations live in one reviewed place
noIndex: false
noContent: false
---

A lot of business logic ends up in a notebook first: a lead score, a price calculation, a forecast, a data-quality check. Rewriting it as a service so that a CRM, an internal tool or a backend can use it takes weeks and splits the logic into two copies.

The [Deepnote API](/docs/deepnote-api) lets other systems call the notebook directly. They send input values, Deepnote runs the notebook on its own machine with the project's integrations and environment, and the caller reads back structured results. The notebook stays the single, reviewable source of the logic.

## What you'll combine

| Feature                            | Role in this playbook                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| [Input blocks](/docs/input-blocks) | The notebook's parameters                                       |
| Runs API                           | Starts a run with input values and returns its results          |
| App data endpoint                  | Returns one JSON result from the caller's newest successful run |
| Sessions API (beta)                | Keeps a machine warm for repeated, low-latency calls            |
| Machines API                       | Starts or resizes the project's machine before heavy use        |
| [Modules](/docs/modules)           | Keep shared logic in one place across notebooks                 |

The API v2 is in preview: endpoints and schemas may change before it's stable, so check the [API reference](/docs/api-reference) before relying on it for production-critical work. All endpoints are listed there. Features marked beta, such as sessions and `machineType`, may change. Requests go to `https://api.deepnote.com/v2` with an API key in the `Authorization: Bearer` header.

## Design the notebook as an endpoint

1. **Inputs are the request.** Add an [input block](/docs/input-blocks) for every parameter the caller sends, with a sensible default. `GET /v2/notebooks/{notebookId}` lists them under `inputs`, and their `name` is the key the caller uses.
2. **One JSON output is the response.** End the notebook with a block that emits the result as JSON:

   ```python
   from IPython.display import display

   display({"application/json": {"account_id": account_id, "score": float(score), "tier": tier}}, raw=True)
   ```

3. **Fail loudly.** Raise an exception when inputs are invalid or data is missing. The run then ends with status `error`, and the caller doesn't treat a half-finished result as an answer.
4. **Keep shared logic in modules**, so the notebook the API calls and the notebooks analysts use compute the same thing.

## Call it

### One-off calls with the runs API

Start a run with `POST /v2/runs`:

```bash
curl -X POST https://api.deepnote.com/v2/runs \
  -H "Authorization: Bearer $DEEPNOTE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notebookId": "<notebook-id>", "inputs": {"account_id": "A-1042"}}'
```

The response contains a `runId`. Runs are detached by default: they run separately from the editor and don't change the outputs anyone working in the notebook sees. They can still write to the project's files, unless you set `detachedRunStorageMode` to `"readonly"`. Poll `GET /v2/runs/{runId}` until `status` is no longer `pending` or `running`. The final status is `success`, `error`, `internal_error` or `stopped`. The outputs are stored a moment later, so after a `success` keep polling until `snapshotStatus` is `available` before you read the result.

Then read the result in one of two ways:

- **`GET /v2/notebooks/{notebookId}/app-data`** returns the first JSON output, and the agent block summary if there is one, from the caller's own newest successful detached run. It's the simplest way to get a single result. Read it only when your run ended with `success`; after `error`, `internal_error` or `stopped`, return an error instead, because the endpoint would return an older run's result.
- **`GET /v2/runs/{runId}?snapshotDelivery=blocks`** returns every executed block with its outputs, for callers that need more than one value. Large outputs are shortened unless you add `fullOutputs=true`. That only returns what the run stored: printed output (stdout and stderr) is cut to its last 1,000 lines or 600,000 characters, whichever is shorter, when the block runs, and nothing can bring back the dropped part.

The app data endpoint returns the caller's newest successful run, not the run you just started. If the same key can start more than one run at a time, or a run can fail, it can return another request's result or an older one. Whenever a result has to match its request, read it from `GET /v2/runs/{runId}?snapshotDelivery=blocks` instead.

Useful options on `POST /v2/runs`:

- **`detachedRunStorageMode: "readonly"`** (beta) mounts project storage read-only, so a run can't change files that other runs depend on. It only protects project files: the notebook can still write to databases and call other services.
- **`machineType`** (beta) runs on a larger machine, as an `id` from `GET /v2/machine-types`, without changing the project's own machine.

### Repeated calls with a session

Each detached run starts its own machine, so the first result takes as long as the machine takes to start. When a system calls the same notebook many times in a row, for example scoring a batch of records one at a time, use a session (beta):

1. `POST /v2/sessions` with the `notebookId` starts a machine, runs the notebook once and keeps it alive. That first run uses the `inputs` you send with the request, or the notebook's saved values if you send none, so pass the first record's inputs, or make sure a run with the saved values changes nothing. `idleShutdownSeconds` sets how long it waits for the next request.
2. `POST /v2/sessions/{sessionId}/runs` runs the notebook again on the warm machine. Requests sent while it's busy are queued. The session runs its own copy of the notebook, so later changes to the source notebook don't reach it; after changing the notebook, start a new session.
3. `DELETE /v2/sessions/{sessionId}` stops it when you're done.

Only the person whose key created a session can use it. Running arbitrary code in a session with `POST /v2/sessions/{sessionId}/execute` also requires Edit access to the project.

### Warming up for a busy period

The machines API controls a project's machine, which the editor, live runs and hosted [Streamlit apps](/docs/streamlit-app-projects) use:

- `POST /v2/projects/{projectId}/machine/start` starts it before a scheduled meeting or a daily peak.
- `PATCH /v2/projects/{projectId}/machine` changes the machine type or the idle shutdown time. A new machine type applies on the next start. To change it while the machine is running, send `"restart": true`, which loses the kernel's variables; without it the request returns `409` and changes nothing.
- `POST /v2/projects/{projectId}/machine/stop` stops it afterwards to save cost.

## Security

- **A key acts as the person who created it.** Runs use that person's permissions, and runs in private projects work only with the project owner's key. If they leave the workspace or are suspended or deactivated, the key stops working. Create keys for production systems from an account whose lifetime matches the integration, and replace them when people change roles.
- **Keep the key on the server.** Never put an API key in a browser, a mobile app or a spreadsheet. For a web front end that runs notebooks as the signed-in viewer, build a [data app project](/docs/data-app-projects) instead.
- **Credentials stay in Deepnote.** The calling system never sees database passwords. It sends inputs and receives results.
- **Validate inputs in the notebook.** Inputs come from another system. Check them before they reach a SQL query, and bind them as [SQL parameters](/docs/sql-cells) rather than building query strings by hand.

## Limits

Requests are rate limited per minute for each API key, at a level set by the workspace's plan. A response with status 429 means the limit was reached. Wait for the number of seconds in its `Retry-After` header, then retry.

## Example

The `Renewal quote` notebook behind the [Renewal deal desk](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software/deal-desk) in the Lindquett Software
example serves two callers. The deal desk app runs it when an account manager picks an account, and
`crm-client.mjs` shows what a CRM does to get the same quote through the runs API: pass `account_id` and
`term_years`, wait for the run, and read the `quote` from its `application/json` output.

## Plan requirements

- **API keys:** Team and Enterprise.
- **Larger machines:** depend on your plan and its machine quota. `GET /v2/machine-types` shows which types the workspace can use.

## Variations

- **Lead scoring for a CRM:** the CRM calls the notebook when a lead is created, passing the lead ID. The notebook joins product usage from the warehouse and returns a score and a tier.
- **Price quotes:** an internal quoting tool sends the configuration and gets back a price computed with the same model finance reviews.
- **Batch enrichment:** a nightly job opens a session, submits one run per file, and stops the session when the batch is done.

## Related

- [Running notebooks from Airflow, Dagster or your own pipeline](/docs/playbook-orchestrator-triggered-runs)
- [Deepnote API](/docs/deepnote-api)
