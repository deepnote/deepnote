# CLI: Sync Command

Install: `npm install -g @deepnote/cli`

## `deepnote sync [dir]`

Sync Deepnote Cloud projects with a local directory (both directions). Every project in the
workspace becomes `<folder path>/<project name>.deepnote`, mirroring the workspace folder tree;
local edits to tracked files are pushed back to Deepnote on the next sync. Requires an API token
(`--token` or `DEEPNOTE_TOKEN`); the token determines the workspace.

| Option                       | Description                                                             |
| ---------------------------- | ----------------------------------------------------------------------- |
| `--url <url>`                | API base URL (default `https://api.deepnote.com`)                       |
| `--token <token>`            | Bearer token (or `DEEPNOTE_TOKEN` env var)                              |
| `--all-files`                | Also download each project's working-directory files (incremental)      |
| `--on-conflict <mode>`       | Conflict handling: `ask` (default), `skip`, `override`                  |
| `--delete-missing-notebooks` | When pushing, delete cloud notebooks removed from the local file        |
| `--prune`                    | Delete local files for projects/files that no longer exist in the cloud |
| `--dry-run`                  | Show what would be synced without writing anything                      |
| `-o, --output <format>`      | Output format: `json`, `llm`                                            |

**Examples:**

```bash
# Mirror the whole workspace into ./workspace
deepnote sync workspace

# Also download working-directory files (data, requirements.txt, …)
deepnote sync workspace --all-files

# Non-interactive (cron/CI): skip anything conflicting
deepnote sync workspace --on-conflict skip

# Preview without writing
deepnote sync workspace --dry-run

# Machine-readable summary
deepnote sync workspace -o json
```

## How sync decides

State lives in `.deepnote-sync.json` in the synced directory: a map of project id → local path,
last-synced `metadata.modifiedAt`, and a content hash. Projects are tracked by id because names
(projects and folders) are **not unique** in Deepnote — cloud renames become local file moves, and
path collisions get a deterministic ` (<short id>)` suffix.

Per project, comparing the local file and a fresh export against the last-synced hash yields:

- both match → unchanged (the export is deterministic, so this is a byte comparison)
- only cloud changed → pull (overwrite the local file)
- only local changed → push (`POST /import` with `baseModifiedAt` + `baseContentHash` for
  lost-update protection — the hash catches editor block edits the timestamp cannot see; a 409
  means the cloud moved concurrently → override or skip)
- both changed → conflict → keep the cloud version or skip (per `--on-conflict`; `ask` degrades
  to skip when there is no terminal)

After a successful push the file is rewritten from a fresh export: imports assign ids to new
notebooks, and the server never applies the project name, integrations, or
`settings.requirements` from a pushed document (`requirements.txt` is the source of truth for
requirements).

With `--all-files`, each project's working-directory files are downloaded into
`<project name>.files/` next to the `.deepnote` file, incrementally (by inventory
`size`/`updatedAt`). Files are download-only; sync does not upload working-directory files.

## Boundaries

- Sync never creates or deletes cloud projects. Local-only `.deepnote` files are reported and left
  alone (use `deepnote open` to import one).
- Local files are never deleted unless `--prune` is passed.
- Pushing a local file with **no notebooks** under `--delete-missing-notebooks` would delete every
  notebook in the cloud project, so sync confirms it like a conflict first (`ask` prompts,
  `override` proceeds, `skip` — and `ask` without a terminal — skips).
- Git is not involved: sync writes ordinary files; commit/branch/push yourself.

**Exit codes:** `0` success (skipped conflicts included), `1` one or more projects failed, `2`
invalid usage (missing token, bad arguments).
