---
title: Syncing a workspace with the Deepnote CLI
description: Mirror your Deepnote workspace to a local directory with deepnote sync, and push local notebook edits back to the cloud
noIndex: false
noContent: false
---

`deepnote sync` mirrors your whole Deepnote workspace into a local directory and pushes local edits
back. Every project becomes a directory holding one `.deepnote` file per notebook, laid out along
your workspace's folder tree.

```bash
deepnote sync ./workspace
```

<Callout status="warning">
**`deepnote sync` is not the same feature as "Deepnote file sync."**

- **[Deepnote file sync](/docs/deepnote-file-sync)** is the in-product feature. You link one cloud
  project to one `.deepnote` file inside a connected Git repository, and Deepnote keeps the two in
  step automatically. You drive it from the project menu in the Deepnote editor.
- **`deepnote sync`** is a local command-line tool. It mirrors _many_ projects — a whole workspace —
  into a directory on your machine, on demand, and does not involve Git at all. You drive it from
  your terminal.

They can be used together, but they are separate mechanisms with separate state.
</Callout>

## Prerequisites

- **The Deepnote CLI.** Install it with `npm install -g @deepnote/cli` (or run it through
  `npx @deepnote/cli`).
- **An API token** with access to the workspace you are mirroring.

## Authentication

The CLI reads your token from the `DEEPNOTE_TOKEN` environment variable, or from an explicit
`--token` flag. Create a token in your workspace under
[Settings & members → API tokens](https://deepnote.com/workspace/settings/api-tokens).

```bash
export DEEPNOTE_TOKEN="<your-token>"
deepnote sync ./workspace
```

Without a token the command exits with code `2` and prints where to get one.

### Token safety

<Callout status="warning">
An API token carries your access to the workspace. Treat it like a password.
</Callout>

- **Prefer the environment variable.** A token passed as `--token` is visible in your shell history
  and in the process list of a shared machine.
- **In CI or a cron job, use a secret** from your provider's secret store, exposed as
  `DEEPNOTE_TOKEN` for that step only.
- **Rotate and revoke** from the same settings page if a token is ever exposed.
- **The token decides which workspace you are mirroring.** Pointing a sync directory at a different
  workspace's token is the most common cause of a confusing first run — see
  [Safety rails](#safety-rails).

## What the local directory looks like

A project maps to a directory, because a project's export is one `.deepnote` document per notebook
rather than a single file:

```
workspace/
├── .deepnote-sync.json          # sync state (safe to commit)
├── Analytics/                   # a workspace folder
│   └── Sales report/            # a project
│       ├── main.deepnote        # one file per notebook
│       ├── forecast.deepnote
│       └── .files/              # working-directory files (--all-files only)
│           ├── requirements.txt
│           └── data/input.csv
└── Scratch project/
    └── main.deepnote
```

`.deepnote-sync.json` is sync's state file. It maps project IDs to local directories and records
fingerprints of what was last synced, which is how sync tells "you edited this" from "someone edited
it in Deepnote." Projects are tracked by ID, not by name, so renaming a project or moving it between
folders in Deepnote becomes a directory move locally rather than a delete and re-download. The file
is plain JSON with sorted keys, so it diffs cleanly if you commit it.

## Both directions

Sync decides per project which way to move, purely by comparing content:

- **Pull** — the project changed in Deepnote, or does not exist locally yet. The exported documents
  are written down.
- **Push** — the project changed only locally. The same documents are uploaded back, with
  lost-update protection: if the cloud copy moved since your last sync, the upload is rejected and
  becomes a conflict rather than a silent overwrite.
- **Unchanged** — both sides match.
- **Conflict** — the project changed both locally and in Deepnote.

Project names and integration attachments are applied from the documents on push. Notebook outputs
are not part of the format, so they never sync.

## Conflicts

By default sync asks, per project, whether to keep the cloud version (discarding your local changes)
or skip the project for now.

```bash
# Answer up front instead of being prompted
deepnote sync ./workspace --on-conflict skip
deepnote sync ./workspace --on-conflict override
```

| Mode       | Behavior                                       |
| ---------- | ---------------------------------------------- |
| `ask`      | Prompt per conflicting project (default)       |
| `skip`     | Leave every conflicting project untouched      |
| `override` | Overwrite local changes with the cloud version |

<Callout status="info">
Without an interactive terminal — in CI, or with output piped — conflicts are skipped rather than
prompted, so an automated sync can never hang waiting for an answer. Skipped conflicts are reported
but do not fail the run.
</Callout>

## Working-directory files

By default sync handles notebooks only. `--all-files` also mirrors each project's
working-directory files — data files, `requirements.txt`, anything else in the project — into a
`.files/` subdirectory:

```bash
deepnote sync ./workspace --all-files
```

Files follow their project's direction: a pulled project downloads changed files, a pushed project
uploads them. Downloads are incremental, so unchanged files are not re-fetched.

Before uploading any file, sync checks its current state in Deepnote. A file that changed — or was
deleted — since sync last recorded it goes through the same `--on-conflict` choice as a diverged
notebook, and skipped files are reported as `N file(s) kept from Deepnote`. This matters because
sync is not the only writer of a project's files: [`deepnote publish`](/docs/deepnote-cli-publish)
deploys into the static root, and anyone editing the project in Deepnote can change files too.

<Callout status="info">
These transfers are buffered in memory, so working-directory files larger than 100 MiB are rejected.
Use another transfer method for larger data files.
</Callout>

## Options

| Option                       | Description                                                                 | Default                    |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| `--all-files`                | Also sync working-directory files (download on pull, upload on push)        | `false`                    |
| `--on-conflict <mode>`       | Conflict handling: `ask`, `skip`, or `override`                             | `ask`                      |
| `--delete-missing-notebooks` | On push, delete cloud notebooks removed from the local project              | `false`                    |
| `--prune`                    | Delete local files for projects and files that no longer exist in the cloud | `false`                    |
| `--dry-run`                  | Report what would be synced without writing anything                        | `false`                    |
| `--token <token>`            | API token                                                                   | `DEEPNOTE_TOKEN`           |
| `--url <url>`                | API base URL (for single-tenant instances)                                  | `https://api.deepnote.com` |
| `-o, --output <format>`      | Machine-readable output: `json` or `llm`                                    | text                       |

## Ownership of the static site directory

A project's published static website lives under `_deepnote_static` in the same file store that
`--all-files` mirrors, so it appears in `.files/_deepnote_static/` like any other project file. The
two commands share one rule:

- **[`deepnote publish`](/docs/deepnote-cli-publish) writes it.** That is the deploy command, and the
  only one that should author those files. Its source of truth is your local build directory.
- **`deepnote sync` mirrors it and never silently overwrites it.** The per-file check described above
  applies to the static root too, so a site someone republished after your last sync is surfaced as
  a conflict instead of being reverted to your older local copy.
- **A publish inside a synced workspace keeps the mirror in step.** Publishing updates the local
  mirror and `.deepnote-sync.json` for you, so the next sync does not see the deploy as drift and
  re-download the whole site.

<Callout status="info">
`.files/_deepnote_static/` is build output, not source. If you commit your sync directory to Git,
consider adding it to `.gitignore` — the site's real source is whatever produces your build
directory.
</Callout>

## Deleting things

Sync is deliberately conservative about deletion, in both directions.

- **Pulls** remove local `.deepnote` files for notebooks that no longer exist in the cloud export.
- **`--prune`** is required before sync deletes a local directory for a project that no longer exists
  in the cloud, or a local working file that no longer exists in the project.
- **`--delete-missing-notebooks`** is required before a push deletes cloud notebooks you removed
  locally.
- **Files removed locally are never deleted in the cloud** by `--all-files` alone; that is too
  destructive to infer.

<Callout status="info">
`deepnote sync --prune` deletes **local** files that are missing in the cloud. The unrelated
[`deepnote publish --prune`](/docs/deepnote-cli-publish) deletes **remote** files that are missing
locally. The two flags share a name and point in opposite directions.
</Callout>

## Safety rails

- **Sync never creates or deletes cloud projects.** Local `.deepnote` files outside a tracked project
  directory are reported and left alone. Use `deepnote open` to import one.
- **Pruning is refused** when none of the tracked project IDs match the workspace the API returned.
  That combination almost always means the token or `--url` points at a different workspace, and
  pruning on that assumption would delete a correct local mirror. Verify the connection and retry.
- **A stale tracking entry cannot delete a directory** whose path is now used by a current cloud
  project; only the stale tracking is removed.
- **Sync does not run Git.** It writes ordinary files. Committing, branching, and pushing are yours
  to do — which is the main difference from
  [Deepnote file sync](/docs/deepnote-file-sync), where Deepnote drives the repository side.

Use `--dry-run` to see what a run would do before it does it:

```bash
deepnote sync ./workspace --all-files --dry-run
```

## Automating it

`--on-conflict skip` plus `-o json` gives a run that never prompts and reports a parsable summary,
which is what you want from a cron job or CI step:

```bash
deepnote sync ./workspace --all-files --on-conflict skip -o json
```

### Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Success — skipped conflicts are reported but do not fail the run |
| `1`  | One or more projects failed to sync                              |
| `2`  | Invalid usage — missing token or bad arguments                   |

A single broken project does not abort the rest of the workspace; it is reported as an error and the
run continues.

## Choosing between the three

| You want to…                                                            | Use                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| Keep one project in a Git repo, synced automatically by Deepnote        | [Deepnote file sync](/docs/deepnote-file-sync)   |
| Mirror many projects to your machine on demand, and push notebook edits | `deepnote sync`                                  |
| Deploy a built static site or app to a project                          | [`deepnote publish`](/docs/deepnote-cli-publish) |

## Related

- [Publishing static sites with the Deepnote CLI](/docs/deepnote-cli-publish)
- [Deepnote file sync](/docs/deepnote-file-sync) — the in-product Git-linked feature
- [Deepnote file format](/docs/deepnote-format) — what is inside a `.deepnote` file
- [How to set up Deepnote locally](/docs/local-setup) — editors and other local tooling
