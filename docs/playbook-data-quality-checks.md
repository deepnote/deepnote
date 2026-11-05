---
title: "Playbook: data quality checks that run before and after you merge"
description: Write data quality checks once as a Deepnote notebook, run them in CI on every pull request with the Deepnote CLI, and run the same notebook on a schedule in Deepnote Cloud with alerts, auto-pause and a snapshot of every run
noIndex: false
noContent: false
---

Data breaks in two ways: someone changes code that produces it, or the data itself changes underneath you. Checks that run only in CI miss the second. Checks that run only on a schedule catch the first after it has already reached dashboards.

With Deepnote you write the checks once, as a notebook, and run that same notebook in both places: in CI on every pull request with the [Deepnote CLI](/docs/deepnote-cli), and on a schedule in Deepnote Cloud.

## What you'll combine

| Feature                                                                  | Role in this playbook                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| SQL blocks and Python, or [Great Expectations](/docs/great-expectations) | The checks                                                   |
| [Deepnote CLI](/docs/deepnote-cli) `run`                                 | Runs the notebook in CI and fails the job when a check fails |
| [Scheduling](/docs/scheduling)                                           | Runs the same notebook every day in Deepnote Cloud           |
| Schedule notifications and auto-pause                                    | Alerts on failure, and stops a broken schedule               |
| [Run snapshots](/docs/run-snapshots)                                     | What each run saw, for debugging                             |
| [`deepnote sync`](/docs/deepnote-cli-sync)                               | Keeps the notebook in Git and in Deepnote Cloud in step      |

## 1. Write the checks as a notebook

Write each check as a query followed by a block that raises when the data is wrong:

```sql
-- SQL block, result stored in `orphans`
SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE c.id IS NULL
```

```python
assert orphans["n"][0] == 0, f"{orphans['n'][0]} orders reference a missing customer"
```

A notebook run fails at the first block that raises, and later blocks don't run. So:

- **Put the most important checks first**, or collect failures in a list and raise once at the end so a single run reports all of them.
- **Write messages that say what's wrong and how much**, because the error message is what people see first.
- **Use input blocks for anything that differs between environments**, such as the schema name or the date being checked.

For larger suites, [Great Expectations](/docs/great-expectations) runs in a notebook like any other library.

## 2. Run it in CI on every pull request

`deepnote run` executes the notebook without an editor and exits with code `1` when a block fails. With `-o json`, the result names the failed block and a `failureCategory`, such as `in-block` when the block's own code raised.

Locally, `deepnote run` reads database connections from a `.deepnote.env.yaml` file next to the notebook. Commit that file with every secret written as an `env:` reference, for example `password: env:WAREHOUSE_PASSWORD`, and provide the values as CI secrets. Real environment variables take precedence over a local `.env` file. `deepnote integrations pull` creates the file from your workspace's integrations.

A GitHub Actions job looks like this:

```yaml
name: Data quality
on: pull_request

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
      - run: python -m pip install "deepnote-toolkit[server]"
      - run: npx @deepnote/cli run checks/data-quality.deepnote --block-timeout 600 -o json
        env:
          WAREHOUSE_PASSWORD: ${{ secrets.WAREHOUSE_PASSWORD }}
```

Point CI at a staging or development database with a read-only user, and keep the production credentials for the scheduled run.

## 3. Run the same notebook on a schedule

Keep the notebook in Git and in Deepnote Cloud at the same time: [`deepnote sync`](/docs/deepnote-cli-sync) mirrors your workspace to a local folder and pushes edits back, so the file CI runs is the notebook Deepnote schedules.

In Deepnote Cloud, [schedule](/docs/scheduling) the notebook:

1. **Choose a time after your data loads**, for example daily at 07:00 in your team's time zone.
2. **Add failure notifications** to the Slack channel that owns the data, or to the people responsible by email.
3. **Keep auto-pause on.** New schedules pause after 3 consecutive failures, and never before about an hour of failures for frequent schedules. A check that keeps failing then stops using compute until someone looks. You can change the number of failures or turn auto-pause off.

When a scheduled run fails, open its [run snapshot](/docs/run-snapshots) to see which check failed and what the data looked like at the time, even if someone has run the notebook since.

## 4. Act on failures

- **Notifications link to the notebook.** They say that the run failed but don't include the error, so open the run to see which check failed.
- **Resume a paused schedule** from the scheduling settings once the data is fixed.
- **Track the trend.** `GET /v2/notebooks/{notebookId}/runs` in the [Deepnote API](/docs/deepnote-api) returns the notebook's run history, if you want to chart check failures over time.

## Plan requirements

- **Running checks in CI with the CLI:** free and open source. The CLI needs a Deepnote API key only for commands that talk to Deepnote Cloud, such as `integrations pull` and `sync`.
- **Scheduling and API keys:** Team and Enterprise.
- **Schedules more frequent than hourly:** Enterprise.

## Variations

- **dbt projects:** run the checks notebook after `dbt build` in the same CI job, so model changes are tested against the checks analysts care about as well as dbt's own tests.
- **Freshness checks:** a check that fails when the newest row is older than expected catches stalled pipelines that produce no errors of their own.
- **Reconciliation:** compare totals between the source system and the warehouse, and fail when they differ by more than an agreed tolerance.
