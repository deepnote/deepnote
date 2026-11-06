---
title: Running notebooks with the Deepnote API
description: Run a Deepnote notebook from your own code with input values, wait for it to finish, read its outputs as JSON, and manage schedules through the API
noIndex: false
noContent: false
---

A notebook is a function your other systems can call. Pass it input values, let it run with the
project's environment and integrations, and read back the tables, charts and text it
produced. Use this to put a notebook behind a product feature, refresh a report when a pipeline
finishes, or post this week's numbers to Slack.

All examples use `$DEEPNOTE_TOKEN`; see [Authentication](/docs/deepnote-api#authentication).

## 1. Find the notebook and its inputs

`GET /v2/notebooks/{notebookId}` returns the notebook's blocks and, when it has
[input blocks](/docs/input-blocks), the inputs you can set:

```bash
curl -s "https://api.deepnote.com/v2/notebooks/$NOTEBOOK_ID" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" | jq '.notebook.inputs'
```

```json
[
  {
    "name": "region",
    "type": "input-select",
    "value": "EU",
    "options": ["EU", "US"]
  },
  { "name": "since", "type": "input-date", "value": "2026-01-01" }
]
```

Each input has a `name`, its `type` and its current `value`, plus `options`, `min`, `max` or `step`
where the input type has them.

## 2. Start a run

```bash
curl -s -X POST https://api.deepnote.com/v2/runs \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notebookId": "'"$NOTEBOOK_ID"'",
    "inputs": { "region": "US", "since": "2026-10-01" }
  }'
```

```json
{
  "runId": "4f6c…",
  "status": "pending",
  "createdAt": "2026-11-04T09:00:00.000Z"
}
```

Input values are strings, booleans (checkboxes) or arrays of strings (multi-selects), keyed by
input `name`. They never change the values saved in the notebook. In a detached run they apply to
that run only; in a live run (`"detached": false`) they stay in the kernel and affect later
executions until they are overwritten or the kernel restarts.

By default the run is **detached**: Deepnote runs a copy of the notebook on its own machine, so it
does not disturb anyone working in the editor and does not change the outputs they see. A detached
run also accepts:

- `machineType`: run on different hardware than the project uses, for example a GPU for one heavy
  job. Valid ids come from `GET /v2/machine-types`. It needs permission to manage the project's
  hardware and a plan that includes that machine.
- `detachedRunStorageMode: "readonly"`: make the project's persistent storage read-only for the
  run. The run can still create temporary files.

Set `"detached": false` to run in the project's live editor session instead. A live run reuses the
kernel's state and updates the outputs everyone sees, and it can run selected blocks with
`blockIds`. Add `"runDependentBlocks": true` to also re-run the blocks that depend on them.

## 3. Wait for the result and read the outputs

Poll `GET /v2/runs/{runId}` until `status` is one of `success`, `error`, `internal_error` or
`stopped`. Ask for `snapshotDelivery=blocks` to get every executed block's outputs as JSON:

```bash
curl -s "https://api.deepnote.com/v2/runs/$RUN_ID?snapshotDelivery=blocks" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN"
```

The response's `run.snapshotBlocks` lists each block with its `id`, `type` and Jupyter-style
`outputs`. Outputs are stored a moment after the run finishes, so also wait until `snapshotStatus`
is no longer `pending`: it becomes `available`, or `unavailable` when nothing was stored. A notebook
with no blocks to run can stay `pending`, so stop waiting after a short while. Very large outputs
are shortened to `outputHead` and `outputTail` unless you add `fullOutputs=true`.

There are two other ways to receive the result:

| `snapshotDelivery`      | You get                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `downloadUrl` (default) | `snapshotDownloadUrl`, a short-lived link to the full `.snapshot.deepnote` file |
| `inline`                | `snapshotContent`, the same file as a string in the response                    |
| `blocks`                | `snapshotBlocks`, the executed blocks with their outputs and no source          |

A snapshot is a regular [`.deepnote` file](/docs/deepnote-format) with outputs, so you can open it
in the editor, keep it as a record, or read it with the
[Deepnote CLI](/docs/deepnote-cli) (`deepnote cat`, `deepnote inspect`).

### End to end in Python

```python
import os
import time

import requests

API = "https://api.deepnote.com/v2"
HEADERS = {"Authorization": f"Bearer {os.environ['DEEPNOTE_TOKEN']}"}
DONE = {"success", "error", "internal_error", "stopped"}
# (connect, read) timeouts, so a stalled request fails instead of hanging. The read timeout
# limits each wait for data, not the whole response, so `timeout` below is best effort: a
# request started just before the deadline can finish after it.
REQUEST_TIMEOUT = (5, 30)


def wait_for_retry(response: requests.Response, deadline: float, message: str) -> None:
    delay = int(response.headers["Retry-After"])
    if time.monotonic() + delay > deadline:
        raise TimeoutError(message)
    time.sleep(delay)


def poll_timeout(run_id: str, status: str | None, timeout: float) -> str:
    if status in DONE:
        return f"Run {run_id} ended with {status}, but its outputs weren't stored within {timeout} seconds"
    return f"Run {run_id} did not finish within {timeout} seconds"


def run_notebook(notebook_id: str, inputs: dict, timeout: float = 1800) -> list[dict]:
    deadline = time.monotonic() + timeout

    while True:
        if time.monotonic() > deadline:
            raise TimeoutError("Rate limited for longer than the timeout")
        response = requests.post(
            f"{API}/runs",
            headers=HEADERS,
            json={"notebookId": notebook_id, "inputs": inputs},
            timeout=REQUEST_TIMEOUT,
        )
        # A 429 means the run was not created, so starting it again is safe.
        if response.status_code == 429:
            wait_for_retry(response, deadline, "Rate limited for longer than the timeout")
            continue
        response.raise_for_status()
        break

    run_id = response.json()["runId"]

    status = None
    snapshot_checks = 0
    while True:
        if time.monotonic() > deadline:
            raise TimeoutError(poll_timeout(run_id, status, timeout))
        try:
            response = requests.get(
                f"{API}/runs/{run_id}",
                headers=HEADERS,
                params={"snapshotDelivery": "blocks"},
                timeout=REQUEST_TIMEOUT,
            )
        except (requests.ConnectionError, requests.Timeout):
            # Reading a run is safe to repeat, and the run keeps going meanwhile.
            time.sleep(max(0, min(5, deadline - time.monotonic())))
            continue
        if response.status_code == 429:
            wait_for_retry(response, deadline, poll_timeout(run_id, status, timeout))
            continue
        response.raise_for_status()
        result = response.json()["run"]
        status = result["status"]
        if status in DONE:
            # Outputs are stored a moment later; a notebook with nothing to run never gets them.
            if result["snapshotStatus"] != "pending" or snapshot_checks >= 6:
                break
            snapshot_checks += 1
        time.sleep(max(0, min(5, deadline - time.monotonic())))

    if status != "success":
        raise RuntimeError(result.get("error") or status)
    return result["snapshotBlocks"] or []


blocks = run_notebook(os.environ["NOTEBOOK_ID"], {"region": "US"})
for block in blocks:
    for output in block["outputs"]:
        print(block["type"], output.get("output_type"))
```

## Return structured data from a notebook

When the caller is code rather than a person, have the notebook return exactly the data it needs.
Display a JSON object in a block as an `application/json` output:

```python
from IPython.display import display

display({"application/json": {"revenue": float(total), "orders": int(order_count)}}, raw=True)
```

`GET /v2/notebooks/{notebookId}/app-data` then returns that object as `appData` from your newest
successful detached run of the notebook, together with `agentBlockSummary` when the notebook has an
[agent block](/docs/deepnote-agent) that writes a summary. It reads the first `application/json`
output, so keep one such block per notebook. This is the same mechanism
[data apps](/docs/data-app-projects) use to get their data.

## Run history

`GET /v2/notebooks/{notebookId}/runs` lists past runs of a notebook (started from the editor, a
schedule or the API), newest first, with their status and timestamps. It returns 20 runs per page
by default (`pageSize` up to 100); pass `pagination.nextPageToken` as `pageToken` to get older ones
until `hasMore` is `false`. Pass any `runId` to
`GET /v2/runs/{runId}` to read that run's outputs while its snapshot is kept; `snapshotExpiresAt`
says how long that is. See [Run snapshots](/docs/run-snapshots).

## Schedules

Keep schedules in code alongside everything else:

```bash
# Every weekday at 07:00 New York time
curl -s -X POST "https://api.deepnote.com/v2/notebooks/$NOTEBOOK_ID/schedule" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "cron": "0 7 * * 1-5", "timezone": "America/New_York" }'
```

The same path takes `GET` to read the schedule, including `nextRunAt` and whether it is paused, and
`DELETE` to remove it. Each notebook has at most one schedule. Posting again updates its `cron` and
`timezone`, keeps its notification settings, resumes it if it was paused after failures, and makes
you its owner. `timezone` defaults to UTC. Creating or changing a schedule needs a plan that includes
scheduling, hourly and custom cron schedules need Team or Enterprise, and schedules that run
more often than once an hour need Enterprise. See
[Scheduling](/docs/scheduling) for what a scheduled run does, and
[`deepnote schedule`](/docs/deepnote-cli) for the same from the terminal.

## Related

- [Deepnote API](/docs/deepnote-api) and the [API reference](/docs/api-reference)
- [Interactive sessions](/docs/deepnote-api-sessions): keep state between runs
- [Running notebooks in CI](/docs/deepnote-cli-ci): `deepnote run --cloud` does all of the above
  in one command
