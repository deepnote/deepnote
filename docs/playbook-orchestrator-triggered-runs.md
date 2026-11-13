---
title: "Playbook: running notebooks from Airflow, Dagster or your own pipeline"
description: Trigger Deepnote notebooks when upstream data is ready instead of on a fixed clock, fail the pipeline when a notebook fails, and manage schedules as code
noIndex: false
noContent: false
---

A [scheduled notebook](/docs/scheduling) runs at a fixed time. If the warehouse load that feeds it is late, the notebook runs on yesterday's data and nobody notices. If the load finishes early, the report still waits for the clock.

When you already orchestrate your data pipeline with Airflow, Dagster, Prefect, dbt Cloud or GitHub Actions, make the Deepnote notebook a step in that pipeline. It then runs right after its inputs are ready, and a failed notebook fails the pipeline where your team already looks.

## What you'll combine

| Feature                                      | Role in this playbook                                 |
| -------------------------------------------- | ----------------------------------------------------- |
| Runs API                                     | Starts the notebook and reports how the run ended     |
| [Input blocks](/docs/input-blocks)           | Pass the partition or date the pipeline just produced |
| Schedules API                                | Keep a schedule as a fallback, defined in code        |
| Notebook runs API                            | Run history for monitoring                            |
| [Scheduling notifications](/docs/scheduling) | Slack and email alerts for scheduled runs             |

All endpoints are listed in the [API reference](/docs/api-reference). The API v2 is in preview, so endpoints and schemas may change before it's stable. Requests go to `https://api.deepnote.com/v2` with an API key in the `Authorization: Bearer` header.

## The pattern

Every orchestrator does the same three things:

1. **Start a run** with `POST /v2/runs`, passing the notebook ID and any input values, such as the date that just finished loading.
2. **Wait** by polling `GET /v2/runs/{runId}` until `status` is `success`, `error`, `internal_error` or `stopped`.
3. **Succeed or fail the task** based on that status.

This helper works in Python orchestrators whose tasks can wait for the run to finish. It needs Python 3.10 or later and `requests`:

```python
import os
import time

import requests

API = "https://api.deepnote.com/v2"


def wait_if_rate_limited(response: requests.Response, deadline: float) -> bool:
    if response.status_code != 429:
        return False
    wait = int(response.headers.get("Retry-After", 15))
    time.sleep(max(0, min(wait, deadline - time.monotonic())))
    return True


def run_notebook(notebook_id: str, inputs: dict | None = None, timeout_s: int = 3600) -> dict:
    # Read the key when the task runs, so the orchestrator can inject it at that point
    headers = {"Authorization": f"Bearer {os.environ['DEEPNOTE_API_KEY']}"}
    deadline = time.monotonic() + timeout_s

    # Retry only a 429: a request that timed out may still have started a run
    while True:
        response = requests.post(
            f"{API}/runs",
            headers=headers,
            json={"notebookId": notebook_id, "inputs": inputs or {}},
            timeout=30,
        )
        if not wait_if_rate_limited(response, deadline):
            break
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Could not start a run of {notebook_id} within {timeout_s} seconds")
    response.raise_for_status()
    run_id = response.json()["runId"]

    while time.monotonic() < deadline:
        try:
            response = requests.get(f"{API}/runs/{run_id}", headers=headers, timeout=30)
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(15)  # The run keeps going; try again
            continue
        if wait_if_rate_limited(response, deadline):
            continue
        if response.status_code >= 500:
            time.sleep(15)  # A server error doesn't stop the run; try again
            continue
        response.raise_for_status()
        run = response.json()["run"]
        if run["status"] == "success":
            return run
        if run["status"] in ("error", "internal_error", "stopped"):
            raise RuntimeError(f"Deepnote run {run_id} ended with {run['status']}: {run.get('error')}")
        time.sleep(15)

    raise TimeoutError(f"Deepnote run {run_id} did not finish within {timeout_s} seconds")
```

If starting a run fails with a network error or a server error, the helper raises instead of retrying, because the run may already have started. The same applies when your orchestrator retries a failed task: the retry starts a new run while the first may still be going. Either turn off retries for this task, or save the `runId` in your orchestrator's task state as soon as the start succeeds, and have a retry resume polling that run instead of starting a new one. If the saved run has already ended with `error`, `internal_error` or `stopped`, polling it again only returns the same failure, so start a new run, as long as the notebook is safe to run twice. Don't pick a run from `GET /v2/notebooks/{notebookId}/runs` by time alone: other tasks and schedules can run the same notebook, and the list doesn't show a run's inputs. If a start failed without returning a `runId`, check the run history by hand before running again, and rely on the notebook being safe to run twice.

Call it from an Airflow `PythonOperator`, a Dagster op, a Prefect task or a GitHub Actions step, after the task that loads the data:

```python
run_notebook("<notebook-id>", inputs={"load_date": "2026-11-04"})
```

Things to know:

- **Runs are detached by default.** Each run uses a separate copy of the project, so a pipeline run never disturbs someone editing the notebook, and two runs of the same notebook can happen at once.
- **Input values are per run.** Use them for the partition, date or tenant the pipeline just processed. Keys are the input `name`s listed by `GET /v2/notebooks/{notebookId}`.
- **The API has no endpoint to cancel a run.** The helper's timeout stops waiting, but the run continues until it finishes.
- **Read results if the next step needs them.** Outputs are stored a moment after the run finishes, so keep polling until `snapshotStatus` is `available`. Then add `?snapshotDelivery=blocks` to `GET /v2/runs/{runId}` to get that run's own outputs. A block whose outputs are longer than 16,384 characters of JSON comes back as a notice with `outputHead` and `outputTail` excerpts; add `&fullOutputs=true` when the next step needs the complete result. That only returns what the run stored: printed output (stdout and stderr) is already shortened when it's stored and marked `truncated`, so check that flag before treating printed output as complete, and return results through a JSON output instead. `GET /v2/notebooks/{notebookId}/app-data` returns the first JSON output from the newest successful detached run started by the API key's owner, which isn't necessarily the run you started: two tasks using the same key can get each other's partition or tenant, and runs started by other people are ignored, so it can return an older result or a 404. Read the run's blocks when the result has to match the run you started. See [a notebook as a backend](/docs/playbook-notebook-as-a-backend).

## Keep a schedule as a fallback

If the orchestrator itself is down, nothing triggers the notebook. A schedule that runs a few hours after the expected load time catches that case. The schedule doesn't receive a `load_date` from the orchestrator, so the notebook has to work out which partition to process itself, for example yesterday's date or the newest partition in the source table. Plan for three cases:

- **The data is late.** Run the schedule several times through the window when the data can arrive, for example hourly through the morning, and have the notebook stop quietly when the data isn't loaded yet, so a later run picks it up.
- **Both runs start.** The orchestrator's run and the schedule can process the same partition at the same time. Start the notebook by claiming the partition atomically, for example by inserting a row into a claims table with the partition as its unique key, and stop if the insert fails because another run holds it. A table that records finished partitions isn't enough on its own, because both runs can check it before either finishes.
- **A run repeats.** Make the notebook's writes safe to repeat: update existing rows or replace the partition rather than appending, and don't send notifications from a run that found the partition already claimed. Manage the schedule in code alongside the pipeline:

- `POST /v2/notebooks/{notebookId}/schedule` with `cron` and `timezone` creates or updates the schedule.
- `GET /v2/notebooks/{notebookId}/schedule` returns the next run time, whether the schedule is paused, and why: `access-revoked` or `consecutive-failures`.
- `DELETE /v2/notebooks/{notebookId}/schedule` removes it.

Schedules created through the API start with auto-pause off; turn it on in the scheduling settings if you want repeated failures to pause the schedule. Schedules more frequent than hourly need the Enterprise plan.

## Monitor from one place

`GET /v2/notebooks/{notebookId}/runs` lists a notebook's runs, newest first, whether the orchestrator, a schedule or a person started them. In a project that [runs privately](/docs/private-outputs), it lists only the runs started with your key. A small monitoring job can read it for every production notebook and alert when the latest run failed or is older than expected.

Scheduled runs can also notify Slack channels or email recipients on success, on failure or both. API runs don't send these notifications, so rely on your orchestrator's alerting for them.

## Security

- **Store the API key in the orchestrator's secret store**, such as an Airflow connection, a Dagster or Prefect secret, or a GitHub Actions secret. Expose it only to the task that calls Deepnote.
- **The key acts as the person who created it** and stops working if they leave the workspace or are suspended or deactivated. Rotate it when ownership of the pipeline changes.
- **A schedule runs as its owner**, the person who last saved it. If they lose access to the project or are deactivated, Deepnote pauses the schedule and emails them, and the workspace admins too unless the project is private. Saving the schedule again makes the person who saves it the owner and resumes it.

## Limits

API requests are rate limited per minute for each API key, at a level set by the workspace's plan. Starting runs and polling them are counted separately. Polling every 15 seconds uses 4 requests a minute per run, so if many runs are in progress at once and you start getting `429` responses, poll less often or spread the runs across keys. The helper waits and retries when starting or polling a run is rate limited, and keeps polling through network errors. It never retries a start request that timed out, because that run may already have started.

## Example

The [Account health app](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software/account-health) in the Lindquett Software example includes a GitHub Actions
workflow, `ci/after-warehouse-load.yml`, that an upstream pipeline triggers with a `repository_dispatch`
event when the warehouse load finishes. It runs the data checks in Deepnote first and, only if they
pass, the churn-risk notebook that alerts customer success.

## Plan requirements

- **API keys:** Team and Enterprise.
- **Scheduling:** Pro, Team and Enterprise. Hourly and custom cron schedules need Team or Enterprise, but not during a Team trial.
- **Schedules more frequent than hourly:** Enterprise.

## Variations

- **After dbt:** run the reporting notebook as the last step of the dbt job, passing the run date, so dashboards refresh only after models pass their tests.
- **When a file lands:** a storage event triggers a small function that starts the notebook with the file path as an input.
- **Per tenant:** loop over customers in the orchestrator and start one run per customer, each with its own `customer_id` input.

## Related

- [A notebook as a backend for your other systems](/docs/playbook-notebook-as-a-backend)
- [Scheduling](/docs/scheduling)
