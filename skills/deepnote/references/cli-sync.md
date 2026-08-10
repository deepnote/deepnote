# CLI: Sync Command

Install: `npm install -g @deepnote/cli`

## `deepnote sync [dir]`

Sync Deepnote Cloud projects with a local directory, both directions. Every project in the workspace
becomes a directory `<folder path>/<project name>/` holding one `.deepnote` file per notebook,
mirroring the workspace folder tree. Requires an API token (`--token` or `DEEPNOTE_TOKEN`); the token
determines the workspace.

Pull writes the exported documents down. Push is the exact inverse: a project edited only locally is
re-uploaded as the same ZIP of `.deepnote` documents to the project import endpoint, with
lost-update protection. Project name and integration attachment edits are applied from the shared
document metadata. `--all-files` also uploads changed working-directory files on push.

| Option                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `--url <url>`                | API base URL (default `https://api.deepnote.com`)                                   |
| `--token <token>`            | Bearer token (or `DEEPNOTE_TOKEN` env var)                                          |
| `--all-files`                | Also sync each project's working-directory files (download on pull, upload on push) |
| `--on-conflict <mode>`       | Conflict handling: `ask` (default), `skip`, `override`                              |
| `--delete-missing-notebooks` | On push, delete cloud notebooks that were removed from the local project            |
| `--prune`                    | Delete local directories/files for projects that no longer exist                    |
| `--dry-run`                  | Show what would be synced without writing or uploading anything                     |
| `-o, --output <format>`      | Output format: `json`, `llm`                                                        |

**Examples:**

```bash
# Mirror the whole workspace into ./workspace
deepnote sync workspace

# Also sync working-directory files (data, requirements.txt, …)
deepnote sync workspace --all-files

# Non-interactive (cron/CI): skip anything conflicting
deepnote sync workspace --on-conflict skip

# Preview without writing
deepnote sync workspace --dry-run

# Machine-readable summary
deepnote sync workspace -o json
```

## How sync decides

State lives in `.deepnote-sync.json` in the synced directory: a map of project id → local directory,
the notebook filenames last synced, the last-synced `metadata.modifiedAt`, and a content hash.
Projects are tracked by id because names (projects and folders) are **not unique** in Deepnote —
cloud renames become local directory moves, and path collisions get a deterministic ` (<short id>)`
suffix.

A project export is a ZIP of one `.deepnote` document per notebook; the documents are deterministic
(the ZIP container is not), so the content hash is computed over the documents. Comparing the local
files and a fresh export against the last-synced hash yields:

- both match → unchanged
- only cloud changed → pull (write the notebook files; delete files for notebooks removed in the
  cloud)
- only local changed → push (upload the same documents to `POST /v2/projects/{id}/import` with
  `baseModifiedAt` + `baseContentHash`; a concurrent cloud edit is rejected with 409 → override or
  skip, per `--on-conflict`). After a push the local files are refreshed from a fresh export, since
  the import may assign ids to new notebooks and clears their execution state. The shared
  `project.name` and integration attachments are applied; `settings.requirements` is not. Every
  document in a multi-notebook project must carry the same project name and integration ids.
- both changed → conflict → keep the cloud version or skip (per `--on-conflict`; `ask` degrades to
  skip when there is no terminal)

Push is the **exact inverse** of export — the same ZIP of documents, no re-merge — so the round-trip
does not churn. The server contract this defines is in
`packages/cloud/docs/project-import-contract.md`.

A document-driven project rename leaves the files in their current directory for that run. The next
sync sees the new name in the project listing and moves the tracked directory through the normal
cloud-rename path. Renaming the local directory itself does not rename the cloud project.

With `--all-files`, working-directory files sync in the notebook's direction: pulled projects
download changed files into a `.files/` subdirectory (incremental, by inventory `size`/`updatedAt`);
pushed projects upload changed local files (delete-then-upload, since `POST /v2/files` will not
overwrite). Files removed locally are not deleted in the cloud.

## Boundaries

- Sync never creates or deletes cloud **projects**. Local-only `.deepnote` files are reported and
  left alone (use `deepnote open` to import one).
- Local files are never deleted unless `--prune` is passed; cloud notebooks are deleted on push only
  with `--delete-missing-notebooks` (an empty local project is confirmed first).
- Git is not involved: sync writes ordinary files; commit/branch/push yourself.

**Exit codes:** `0` success (skipped conflicts included), `1` one or more projects failed, `2`
invalid usage (missing token, bad arguments).
