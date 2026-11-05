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

All endpoints are listed in the [API reference](/docs/api-reference). Requests go to `https://api.deepnote.com/v2` with an API key in the `Authorization: Bearer` header.

## The pattern

Every orchestrator does the same three things:

1. **Start a run** with `POST /v2/runs`, passing the notebook ID and any input values, such as the date that just finished loading.
2. **Wait** by polling `GET /v2/runs/{runId}` until `status` is `success`, `error`, `internal_error` or `stopped`.
3. **Succeed or fail the task** based on that status.

This helper works in any Python-based orchestrator:

```python
import os
import time

import requests

API = "https://api.deepnote.com/v2"
HEADERS = {"Authorization": f"Bearer {os.environ['DEEPNOTE_API_KEY']}"}


def run_notebook(notebook_id: str, inputs: dict | None = None, timeout_s: int = 3600) -> dict:
    response = requests.post(
        f"{API}/runs",
        headers=HEADERS,
        json={"notebookId": notebook_id, "inputs": inputs or {}},
        timeout=30,
    )
    response.raise_for_status()
    run_id = response.json()["runId"]

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        run = requests.get(f"{API}/runs/{run_id}", headers=HEADERS, timeout=30).json()["run"]
        if run["status"] == "success":
            return run
        if run["status"] in ("error", "internal_error", "stopped"):
            raise RuntimeError(f"Deepnote run {run_id} ended with {run['status']}: {run.get('error')}")
        time.sleep(15)

    raise TimeoutError(f"Deepnote run {run_id} did not finish within {timeout_s} seconds")
```

Call it from an Airflow `PythonOperator`, a Dagster op, a Prefect task or a GitHub Actions step, after the task that loads the data:

```python
run_notebook("<notebook-id>", inputs={"load_date": "2026-11-04"})
```

Things to know:

- **Runs are detached by default.** Each run uses a separate copy of the project, so a pipeline run never disturbs someone editing the notebook, and two runs of the same notebook can happen at once.
- **Input values are per run.** Use them for the partition, date or tenant the pipeline just processed. Keys are the input `name`s listed by `GET /v2/notebooks/{notebookId}`.
- **The API has no endpoint to cancel a run.** The helper's timeout stops waiting, but the run continues until it finishes.
- **Read results if the next step needs them.** Add `?snapshotDelivery=blocks` to the last `GET /v2/runs/{runId}` to get every block's outputs, or call `GET /v2/notebooks/{notebookId}/app-data` for the notebook's JSON output. See [a notebook as a backend](/docs/playbook-notebook-as-a-backend).

## Keep a schedule as a fallback

If the orchestrator itself is down, nothing triggers the notebook. A schedule that runs a few hours after the expected load time catches that case. Manage it in code alongside the pipeline:

- `POST /v2/notebooks/{notebookId}/schedule` with `cron` and `timezone` creates or updates the schedule.
- `GET /v2/notebooks/{notebookId}/schedule` returns the next run time, whether the schedule is paused, and why: `access-revoked` or `consecutive-failures`.
- `DELETE /v2/notebooks/{notebookId}/schedule` removes it.

Schedules more frequent than hourly need the Enterprise plan.

## Monitor from one place

`GET /v2/notebooks/{notebookId}/runs` lists a notebook's runs, newest first, whether the orchestrator, a schedule or a person started them. A small monitoring job can read it for every production notebook and alert when the latest run failed or is older than expected.

Scheduled runs can also notify Slack channels or email recipients on success, on failure or both. API runs don't send these notifications, so rely on your orchestrator's alerting for them.

## Security

- **Store the API key in the orchestrator's secret store**, such as an Airflow connection, a Dagster or Prefect secret, or a GitHub Actions secret. Expose it only to the task that calls Deepnote.
- **The key acts as the person who created it** and stops working if they leave the workspace or are suspended or deactivated. Rotate it when ownership of the pipeline changes.
- **A schedule runs as its owner**, the person who last saved it. If they lose access to the project or are deactivated, Deepnote pauses the schedule and emails them, and the workspace admins too unless the project is private. Saving the schedule again makes the person who saves it the owner and resumes it.

## Limits

API requests are rate limited per minute. Starting a run counts as an execution: 40 per minute on Team and 120 on Enterprise. Polling counts as a read: 600 per minute on Team and 2,000 on Enterprise. Polling every 15 seconds keeps a pipeline far below both.

## Plan requirements

- **API keys and scheduling:** Team and Enterprise.
- **Schedules more frequent than hourly:** Enterprise.

## Variations

- **After dbt:** run the reporting notebook as the last step of the dbt job, passing the run date, so dashboards refresh only after models pass their tests.
- **When a file lands:** a storage event triggers a small function that starts the notebook with the file path as an input.
- **Per tenant:** loop over customers in the orchestrator and start one run per customer, each with its own `customer_id` input.

## Related

- [A notebook as a backend for your other systems](/docs/playbook-notebook-as-a-backend)
- [Scheduling](/docs/scheduling)
