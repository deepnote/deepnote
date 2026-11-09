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

Write each check as a SQL block followed by a block that raises when the data is wrong. Set the SQL block's result variable, here `orphans`, so the next block can read it:

```sql
SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE c.id IS NULL
```

```python
assert orphans["n"][0] == 0, f"{orphans['n'][0]} orders reference a missing customer"
```

A notebook run fails at the first block that raises, and later blocks don't run. So:

- **Put the most important checks first**, or collect failures in a list and raise once at the end so a single run reports all of them.
- **Write messages that say what's wrong and how much**, because the error message is what people see first.
- **Use input blocks for anything that differs between environments**, such as the schema name or the date being checked.

For larger suites, [Great Expectations](/docs/great-expectations) runs in a notebook like any other library. Install it, and any other package the notebook imports, in the CI job as well, for example by adding it to the `pip install` step below.

## 2. Run it in CI on every pull request

`deepnote run` executes the notebook without an editor and exits with code `1` when a block fails. With `-o json`, the result names the failed block and a `failureCategory`, such as `in-block` when the block's own code raised.

Locally, `deepnote run` reads database connections from a `.deepnote.env.yaml` file next to the notebook. Run `deepnote integrations pull` in the notebook's folder, here `checks/`: it writes `.deepnote.env.yaml` with every secret as an `env:` reference, and the secret values into `.env`. Pulled references are named after the integration ID, such as `env:<INTEGRATION_ID>__PASSWORD`; rename them, for example to `env:WAREHOUSE_PASSWORD`, to match your CI secrets, and later pulls keep your names. Rename the matching key in `.env` too, or local runs lose the value. Add `.env` to `.gitignore`, commit only `.deepnote.env.yaml`, and provide the values as CI secrets. Real environment variables take precedence over a local `.env` file. A pull leaves entries that exist only in your local `.deepnote.env.yaml` as they are, so if you wrote any by hand, check them for plaintext secrets and replace those with `env:` references before committing.

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

The job checks the data already in the database it points at. If the pull request changes the pipeline that produces the data, build the branch's data into a separate staging schema first and pass that schema to the notebook as an input. Point CI at a staging or development database with a read-only user, and give the scheduled run a read-only production credential. A `pull_request` job runs the branch's own code with the secret, so anyone who can push a branch to the repository can make the notebook print it; pull requests from forks get no secrets and fail instead. Use a disposable staging credential you can rotate, or run the job only on pushes to the default branch. Don't switch to `pull_request_target` to get secrets for forks, because it would run untrusted code with them.

## 3. Run the same notebook on a schedule

Keep the notebook in Git and in Deepnote Cloud at the same time with [`deepnote sync`](/docs/deepnote-cli-sync), which mirrors your workspace to a local folder and pushes edits back. It runs only when you call it, so after a change merges, run `deepnote sync` from the default branch, by hand or in a CI job on pushes to that branch, so that Deepnote schedules the merged notebook. Sync records what it last synced in `.deepnote-sync.json`. Commit that file, and the notebook files sync rewrites, back to the branch after every run; a CI job that starts from a fresh checkout without them sees both sides as changed and skips the notebook as a conflict. Run it with `-o json` and fail the job when the result reports a skipped conflict, because sync still exits successfully. If someone also edited the notebook in Deepnote, sync reports a conflict instead of overwriting either side. Sync mirrors every project the API key's account can access, not just the checks notebook, and everything it writes ends up in the repository. Use a key from an account that can reach only the projects that belong in this repository. The mirror has to be the folder CI checks out, because sync pushes only what it finds there; a copy kept elsewhere would push the old notebook. Sync handles notebooks only by default. If the checks read a helper module, `requirements.txt` or another file from the project, add `--all-files`, which also uploads the working files of every project in the mirror, and commit those files under each project's `.files/` folder. It downloads them too, including data files and anything else people stored in those projects, so review what it wrote before each commit and add anything sensitive to `.gitignore`. A notebook that reads those files by relative path expects to run in that folder, so in CI pass `--cwd` with the project's `.files/` folder, and keep `.deepnote.env.yaml` there, because `deepnote run` reads it and `.env` from the working directory. Alternatively, use [Deepnote file sync](/docs/deepnote-file-sync). It links the project to a folder in the repository with one `.deepnote` file per notebook, so CI can run the checks notebook's file on its own. Everything else in the project lands in the same folder, so review it before committing. File sync doesn't fetch new commits by itself: after a merge, someone has to pull the repository in the Deepnote project before the schedule runs the merged version.

In Deepnote Cloud, [schedule](/docs/scheduling) the notebook:

1. **Choose a time after your data loads**, for example daily at 07:00 in your team's time zone.
2. **Add failure notifications** to the Slack channel that owns the data, or to the people responsible by email.
3. **Keep auto-pause on.** Schedules you create in Deepnote pause after 3 consecutive failures, and never before about an hour of failures for frequent schedules. A check that keeps failing then stops using compute until someone looks. You can change the number of failures or turn auto-pause off. Schedules created through the API start with auto-pause off.

When a scheduled run fails, open its [run snapshot](/docs/run-snapshots) to see which check failed and what the data looked like at the time, even if someone has run the notebook since.

## 4. Act on failures

- **Notifications link to the notebook.** They say that the run failed but don't include the error, so open the run to see which check failed.
- **Resume a paused schedule** from the scheduling settings once the data is fixed.
- **Track the trend.** `GET /v2/notebooks/{notebookId}/runs` in the [Deepnote API](/docs/deepnote-api) returns the notebook's run history, if you want to chart check failures over time.

## Example

The `Data quality checks` notebook in the [Lindquett Software example](https://github.com/deepnote/deepnote/tree/main/examples/lindquett-software) checks freshness,
duplicates, invalid values and orphaned rows with SQL blocks, then raises an error listing every
failed check. A **Simulate an issue** input breaks the data on purpose so you can see the run fail,
and the example includes a GitHub Actions workflow that runs the notebook on every pull request.

## Plan requirements

- **Running checks in CI with the CLI:** free and open source. The CLI needs a Deepnote API key only for commands that talk to Deepnote Cloud, such as `integrations pull` and `sync`.
- **Scheduling:** Pro, Team and Enterprise.
- **API keys:** Team and Enterprise.
- **Schedules more frequent than hourly:** Enterprise.

## Variations

- **dbt projects:** run the checks notebook after `dbt build` in the same CI job, so model changes are tested against the checks analysts care about as well as dbt's own tests.
- **Freshness checks:** a check that fails when the newest row is older than expected catches stalled pipelines that produce no errors of their own.
- **Reconciliation:** compare totals between the source system and the warehouse, and fail when they differ by more than an agreed tolerance.
