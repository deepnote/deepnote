---
title: Running notebooks in CI with the Deepnote CLI
description: Run Deepnote notebooks without an editor in GitHub Actions or any other CI system with deepnote run, on the runner or in Deepnote Cloud, sync a repository to Deepnote, and keep your API key safe while doing it
noIndex: false
noContent: false
---

`deepnote run` executes a notebook without an editor, prints a machine-readable result and exits
non-zero when a block fails. That is everything a CI step needs, so running notebooks in GitHub
Actions, GitLab CI or any other pipeline needs no plugin: install the CLI and call it.

There are two ways to do it, and they suit different jobs:

|                     | On the runner                                 | In Deepnote Cloud                                                   |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Command             | `deepnote run my-project.deepnote`            | `deepnote run my-project.deepnote --cloud`                          |
| Where the code runs | The CI runner's Python                        | The project's own machine, environment and integrations in Deepnote |
| Needs an API key    | No                                            | Yes                                                                 |
| Good for            | "This notebook still runs" checks on every PR | Scheduled reports, refreshing outputs, runs that need your data     |
| Safe on forked PRs  | Yes, nothing secret is involved               | No, see [Security](#security)                                       |

## Prerequisites

- **The Deepnote CLI.** `npx @deepnote/cli` runs it without a global install. It fetches the latest
  release on every run; to stop a new release from changing a pipeline's behavior under you, pin
  one with `npx @deepnote/cli@<version>`. The CLI
  is also on PyPI as `deepnote-cli` if the runner has Python but no Node.js.
- **For runs on the runner:** a Python interpreter with
  [deepnote-toolkit](https://pypi.org/project/deepnote-toolkit/) installed
  (`pip install "deepnote-toolkit[server]"`), plus whatever packages the notebook imports. The CLI
  does not install the toolkit for you.
- **For runs in Deepnote Cloud:** an API key from a workspace on a plan that includes the
  [Deepnote API](/docs/deepnote-api), and a project in that workspace that holds the notebook.

## Run on the runner

This workflow runs a notebook on every pull request and fails the check if any block raises:

```yaml
# .github/workflows/notebooks.yml
name: Notebooks

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-python@v7
        with:
          python-version: ">=3.10 <3.15" # newest Python deepnote-toolkit supports

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*

      - name: Install deepnote-toolkit and the notebook's dependencies
        run: |
          python -m pip install "deepnote-toolkit[server]"
          python -m pip install -r requirements.txt

      - name: Lint
        run: npx @deepnote/cli lint analysis.deepnote

      - name: Run
        run: |
          npx @deepnote/cli run analysis.deepnote \
            --startup-timeout 60 --block-timeout 300 \
            -o json > run-result.json

      - name: Keep the result
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: run-result
          path: run-result.json
```

A few things this relies on:

- **Which Python runs the notebook.** The CLI uses `--python <path>` if given, then the
  `DEEPNOTE_PYTHON` environment variable, then an interpreter selected in the Deepnote editor
  extension, then a `.venv` or `venv` next to the notebook that has `deepnote-toolkit` installed, and
  finally the system Python. After `actions/setup-python`, the system
  Python is the one you just installed into, so no flag is needed.
- **Timeouts.** `--startup-timeout` bounds how long the toolkit server and the kernel may take to
  start; `--block-timeout` interrupts any single block that runs longer. Set both in CI so a stuck
  notebook fails in minutes instead of running until the job's own timeout.
- **Inputs.** Pass values for input blocks with `--input name=value` (repeatable). Run
  `deepnote run analysis.deepnote --list-inputs` locally to see which inputs a notebook has.
- **Integrations.** Database blocks read their connections from `.deepnote.env.yaml` and secrets
  from `.env`, both next to the notebook (or in the directory given with `--cwd`). Generate those
  files in a step from CI secrets rather than committing them, and only on events that are allowed to
  see secrets.

### Reading the result

With `-o json`, the command prints one JSON object to stdout and exits with:

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| `0`  | Every block ran successfully                                   |
| `1`  | A block failed, or the runtime could not start                 |
| `2`  | Invalid usage: a missing file, an unknown input, or a bad flag |

On failure, `failureCategory` says why, so a pipeline can tell a bug in the notebook from a problem
with the runner:

| `failureCategory`   | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `in-block`          | The block's own code raised                                                                   |
| `execution-timeout` | A block ran longer than `--block-timeout` and was interrupted                                 |
| `kernel-died`       | The kernel ended while a block ran, usually out of memory or a native crash                   |
| `server-exited`     | The deepnote-toolkit server went away mid-run                                                 |
| `server-launch`     | The server never became ready; most often `deepnote-toolkit` is not installed for that Python |
| `kernel-launch`     | The server started but the kernel did not become ready within `--startup-timeout`             |

When the CLI knows the remedy, the result also carries a `hint`, for example the exact
`pip install` command when the toolkit is missing.

## Run in Deepnote Cloud

`--cloud` asks Deepnote to run the notebook on the project's own machine, waits for it to finish and
downloads the resulting snapshot (the notebook with its outputs) into a `snapshots/` directory
next to the source file, or to the exact path given with `--out`.

```yaml
# .github/workflows/nightly-report.yml
name: Nightly report

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: deepnote # holds the DEEPNOTE_TOKEN secret; see Security below
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*

      - name: Run in Deepnote Cloud
        env:
          DEEPNOTE_TOKEN: ${{ secrets.DEEPNOTE_TOKEN }}
        run: |
          npx @deepnote/cli run report.deepnote --cloud \
            --storage-mode readonly --timeout 1200 \
            --out report.snapshot.deepnote -o json
```

- **Which notebook runs.** The CLI reads the project and notebook ids from the `.deepnote` file. If
  the file has several notebooks, choose one with `--notebook "<name>"`. Without a local file, pass
  `--notebook-id <uuid>` instead, but `--input` then cannot be used, because typing input values
  needs the notebook's input blocks from the file.
- **What code runs.** By default Deepnote runs the notebook as it was last saved in Deepnote, not the
  file in your repository. To run what is in the repository, add `--push --yes`: `--push` replaces
  the notebook's blocks in Deepnote with the file's (deleting blocks the file does not have) and
  `--yes` confirms that without a prompt. Without `--yes`, `--push` refuses to run in CI.
- **Storage.** A full-notebook cloud run is detached: it does not change the outputs in the live
  editor. `--storage-mode readonly` also makes the project's persistent storage read-only for that
  run. Databases, integrations and external APIs stay live either way.
- **Timeouts.** `--timeout` (default 600 seconds) is how long the CLI waits. When it expires the
  command fails, but the run may still be executing in Deepnote.
- **Exit codes.** `0` when the run succeeded and its snapshot was downloaded, `1` when the run failed
  or the snapshot could not be fetched, and `2` for a missing or rejected token or bad arguments.

## Keep Deepnote in step with your repository

A pipeline can do more with the CLI than run notebooks. A job that runs
[`deepnote sync`](/docs/deepnote-cli-sync) keeps your repository and Deepnote in step, and is an
alternative to [Deepnote file sync](/docs/deepnote-file-sync), the Git sync built into Deepnote:

|                          | Deepnote file sync                                                                                      | `deepnote sync` in CI                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Set up in                | Each project, with the repository connected in Deepnote                                                 | One workflow in your repository      |
| Scope                    | One project per linked file                                                                             | Every project in the sync directory  |
| Repository → Deepnote    | When someone pulls or switches branch in the Deepnote project                                           | On every merge to the branch         |
| Deepnote → repository    | When someone commits and pushes from Deepnote                                                           | Committed by the job on its schedule |
| Git hosts                | Ones Deepnote connects to: [GitHub](/docs/github), [GitLab](/docs/gitlab), [Bitbucket](/docs/bitbucket) | Any host your CI can push to         |
| Needs a Deepnote API key | No                                                                                                      | Yes                                  |
| Branches                 | Switch branch in the project                                                                            | Follows one branch                   |

Choose file sync when people work on a project's branches inside Deepnote; choose a sync job when the
repository is the source of truth and changes should land in Deepnote on merge without anyone
pulling them.

The job works on a sync directory committed to the repository: one directory per project holding
its `.deepnote` files, and `.deepnote-sync.json` at the root. Create it once from your machine with
`deepnote sync ./workspace` and commit it. Sync never creates cloud projects, so a new project has
to exist in Deepnote before a sync can track it.

```yaml
# .github/workflows/deepnote-sync.yml
name: Sync with Deepnote

on:
  push:
    branches: [main]
    paths: ["workspace/**"]
  schedule:
    - cron: "0 * * * *" # also bring edits made in Deepnote back into the repository
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: deepnote-sync

jobs:
  sync:
    if: github.ref == 'refs/heads/main' # a manual run from another branch would sync that branch
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: deepnote # holds the DEEPNOTE_TOKEN secret; see Security below
    steps:
      - uses: actions/checkout@v7
        with:
          ref: main # the latest main, not the commit that queued this run

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*

      - name: Sync with Deepnote
        env:
          DEEPNOTE_TOKEN: ${{ secrets.DEEPNOTE_TOKEN }}
        run: npx @deepnote/cli sync workspace --on-conflict skip -o json > sync-result.json

      - name: Commit what sync wrote
        if: ${{ !cancelled() }}
        run: |
          git add workspace
          if git diff --cached --quiet; then exit 0; fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Sync with Deepnote"
          git pull --rebase origin main
          git push origin HEAD:main

      - name: Fail if a project was skipped as a conflict
        run: jq -e '[.projects[] | select(.action == "skipped-conflict")] | length == 0' sync-result.json
```

- **Which way each project goes.** Sync compares the local files and Deepnote's copy against the
  content recorded in `.deepnote-sync.json` at the last sync. A project changed only in the
  repository is pushed, one changed only in Deepnote is pulled, and one changed on both sides is a
  conflict. A push is also rejected as a conflict if the project changed in Deepnote since that
  record, so it never silently overwrites an edit.
- **Commit what sync writes.** After pushing a project, sync rewrites its files with Deepnote's
  export and updates `.deepnote-sync.json`. If the job does not commit both, the next run compares
  against the old record, sees both sides changed, and skips the project as a conflict, and keeps
  skipping it. The commit step runs even when sync fails, because projects that did sync still need
  their record kept. A commit pushed with the workflow's `GITHUB_TOKEN` does not start another
  workflow run, so the job does not loop. If branch protection blocks direct pushes to `main`, allow
  this workflow to bypass it, or the commit step fails. If a merge changes the same project while
  the job runs, the rebase stops and nothing is pushed; the next run then reports that project as a
  conflict, which you resolve as below.
- **Conflicts fail the job.** In CI, sync skips conflicts and still exits `0`, so the last step
  checks the JSON result. To resolve one, run `deepnote sync ./workspace` on your machine and keep
  the Deepnote version when it asks, re-apply your change on top, and merge it; the next run pushes
  it.
- **Deletions are opt-in.** A notebook file removed from the repository is deleted in Deepnote only
  with `--delete-missing-notebooks`. With `--all-files`, working-directory files such as
  `requirements.txt` sync too, but files removed locally are never deleted in Deepnote.

The same trigger can deploy apps: run [`deepnote publish`](/docs/deepnote-cli-publish) on pushes to
`main` to republish an app from its build directory.

## Security

<Callout status="warning">
A Deepnote API key gives access to its whole workspace. In CI, anyone who can change the code a job
runs can read the secrets that job is given, and a cloud run executes notebook code with the
project's integrations and data.
</Callout>

Running on the runner involves no Deepnote credentials, so it is safe on any event, including pull
requests from forks. Treat cloud runs, and runs on the runner that are given database secrets, as
deployments:

- **Run them only on trusted events.** Use `push` to a protected branch, `schedule` or
  `workflow_dispatch`. Never give the token to `pull_request_target` or `workflow_run` jobs that check
  out or execute code from a pull request: that hands the key to whoever opened it. GitHub does not
  pass secrets to `pull_request` runs from forks, so the cloud step fails there instead. Run it
  conditionally rather than working around that.
- **Be deliberate with `--push` and `deepnote sync`.** Both upload the repository's version of
  notebooks into your workspace, and `--push` also runs it. Whoever can merge to the branch that
  triggers the job can change, or run code in, your Deepnote projects.
- **Keep the secret in a GitHub Environment** with deployment branch rules (and required reviewers if
  you want a human to approve each run), rather than as a repository-wide secret, and expose it as
  `DEEPNOTE_TOKEN` on the one step that needs it.
- **Limit what the key can reach.** Create it in a workspace that holds only the projects and
  integrations the job needs, and prefer `--storage-mode readonly` unless the notebook must write to
  project storage.
- **Mind what you upload.** The downloaded snapshot contains the notebook's outputs. On a public
  repository, workflow artifacts can be downloaded by anyone who can see the repository, so do not
  upload snapshots of notebooks that print private data.
- **Pin what you run.** Pin the CLI version and, ideally, third-party actions to a commit SHA.
- **Rotate and revoke** the key under **Settings & members → Security → API keys** if it is ever
  exposed.

## Other CI systems

Nothing above is specific to GitHub Actions. On any CI system, install Python with
`deepnote-toolkit[server]` and Node.js (or `pip install deepnote-cli`), then call the same
`deepnote run` command; for cloud runs, expose the API key as `DEEPNOTE_TOKEN` from the system's
secret store on protected branches only.

## Troubleshooting

| Symptom                                                  | Fix                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `server-launch` with `deepnote-toolkit is not installed` | Install `deepnote-toolkit[server]` into the Python the CLI picked, or point at another with `--python` |
| `server-launch` or `kernel-launch` on a slow runner      | Raise `--startup-timeout`                                                                              |
| `ModuleNotFoundError` in a block                         | Install the notebook's own dependencies in the same Python as the toolkit                              |
| Cloud run exits `2` mentioning the token                 | The secret is not set on that step, or the key belongs to a different workspace than the project       |
| `Timed out waiting for Deepnote run`                     | Raise `--timeout`; the run may have finished in Deepnote anyway                                        |
| `--push deletes blocks … needs confirmation`             | Add `--yes`, after making sure the job only runs on trusted events                                     |

## Related

- [Deepnote CLI](/docs/deepnote-cli): install the CLI and see every command
- [Deepnote API](/docs/deepnote-api): the HTTP API that `run --cloud` uses
- [Scheduling](/docs/scheduling): run notebooks on a schedule inside Deepnote, without CI
- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync)
