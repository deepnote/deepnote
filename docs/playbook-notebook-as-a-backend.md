---
title: "Playbook: a notebook as a backend for your other systems"
description: Call a Deepnote notebook from any system that can make an HTTP request, pass it inputs and read back structured results, so scoring, enrichment and calculations live in one reviewed place
noIndex: false
noContent: false
---

A lot of business logic ends up in a notebook first: a lead score, a price calculation, a forecast, a data-quality check. Rewriting it as a service so that a CRM, an internal tool or a backend can use it takes weeks and splits the logic into two copies.

The [Deepnote API](/docs/deepnote-api) lets other systems call the notebook directly. They send input values, Deepnote runs the notebook on its own machine with the project's integrations and environment, and the caller reads back structured results. The notebook stays the single, reviewable source of the logic.

## What you'll combine

| Feature                            | Role in this playbook                                    |
| ---------------------------------- | -------------------------------------------------------- |
| [Input blocks](/docs/input-blocks) | The notebook's parameters                                |
| Runs API                           | Starts a run with input values and returns its results   |
| App data endpoint                  | Returns one JSON result from the caller's latest run     |
| Sessions API (beta)                | Keeps a machine warm for repeated, low-latency calls     |
| Machines API                       | Starts or resizes the project's machine before heavy use |
| [Modules](/docs/modules)           | Keep shared logic in one place across notebooks          |

All endpoints are listed in the [API reference](/docs/api-reference). Requests go to `https://api.deepnote.com/v2` with an API key in the `Authorization: Bearer` header.

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

The response contains a `runId`. Runs are detached by default: they run in a separate copy of the project and don't affect anyone working in the notebook. Poll `GET /v2/runs/{runId}` until `status` is no longer `pending` or `running`. The final status is `success`, `error`, `internal_error` or `stopped`.

Then read the result in one of two ways:

- **`GET /v2/notebooks/{notebookId}/app-data`** returns the first JSON output, and the agent block summary if there is one, from the caller's own newest successful detached run. It's the simplest way to get a single result.
- **`GET /v2/runs/{runId}?snapshotDelivery=blocks`** returns every executed block with its outputs, for callers that need more than one value. Large outputs are shortened unless you add `fullOutputs=true`.

The app data endpoint returns the caller's newest successful run, not a specific run. If one key starts several runs in parallel, read each run with `GET /v2/runs/{runId}` instead.

Useful options on `POST /v2/runs`:

- **`detachedRunStorageMode: "readonly"`** mounts project storage read-only, so a run can't change files that other runs depend on.
- **`machineType`** (beta) runs on a larger machine, as an `id` from `GET /v2/machine-types`, without changing the project's own machine.

### Repeated calls with a session

Each detached run starts its own machine, so the first result takes as long as the machine takes to start. When a system calls the same notebook many times in a row, for example scoring a batch of records one at a time, use a session (beta):

1. `POST /v2/sessions` with the `notebookId` starts a machine, runs the notebook once and keeps it alive. `idleShutdownSeconds` sets how long it waits for the next request.
2. `POST /v2/sessions/{sessionId}/runs` runs the notebook again on the warm machine. Requests sent while it's busy are queued.
3. `DELETE /v2/sessions/{sessionId}` stops it when you're done.

Only the person whose key created a session can use it. Running arbitrary code in a session with `POST /v2/sessions/{sessionId}/execute` also requires Edit access to the project.

### Warming up for a busy period

The machines API controls a project's editor machine, which live runs use, and notebook apps set to **Shared project machine**:

- `POST /v2/projects/{projectId}/machine/start` starts it before a scheduled meeting or a daily peak.
- `PATCH /v2/projects/{projectId}/machine` changes the machine type or the idle shutdown time.
- `POST /v2/projects/{projectId}/machine/stop` stops it afterwards to save cost.

## Security

- **A key acts as the person who created it.** Runs use that person's permissions, and runs in private projects work only with the project owner's key. If they leave the workspace or are suspended or deactivated, the key stops working. Create keys for production systems from an account whose lifetime matches the integration, and replace them when people change roles.
- **Keep the key on the server.** Never put an API key in a browser, a mobile app or a spreadsheet. For a web front end that calls notebooks as the signed-in viewer, use a [static site with viewer API access](/docs/deepnote-cli-publish) instead.
- **Credentials stay in Deepnote.** The calling system never sees database passwords. It sends inputs and receives results.
- **Validate inputs in the notebook.** Inputs come from another system. Check them before they reach a SQL query, and bind them as [SQL parameters](/docs/sql-cells) rather than building query strings by hand.

## Limits

Requests are rate limited per minute for each API key, at a level set by the workspace's plan:

| Plan       | Read | Write | Runs and other executions |
| ---------- | ---- | ----- | ------------------------- |
| Team trial | 30   | 10    | 2                         |
| Team       | 600  | 200   | 40                        |
| Enterprise | 2000 | 600   | 120                       |

A response with status 429 means the limit was reached. Wait for the number of seconds in its `Retry-After` header, then retry.

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
