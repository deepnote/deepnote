# CLI: Sync Command

Install: `npm install -g @deepnote/cli`

## `deepnote sync [dir]`

Mirror Deepnote Cloud projects into a local directory. Every project in the workspace becomes a
directory `<folder path>/<project name>/` holding one `.deepnote` file per notebook, mirroring the
workspace folder tree. Requires an API token (`--token` or `DEEPNOTE_TOKEN`); the token determines
the workspace.

Pull is fully supported. Pushing local edits back to Deepnote is **detected but deferred** — it
depends on the project import endpoint, which is not yet available. A project edited only locally is
reported as `push-deferred` and left untouched (never silently overwritten).

| Option                       | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `--url <url>`                | API base URL (default `https://api.deepnote.com`)                  |
| `--token <token>`            | Bearer token (or `DEEPNOTE_TOKEN` env var)                         |
| `--all-files`                | Also download each project's working-directory files (incremental) |
| `--on-conflict <mode>`       | Conflict handling: `ask` (default), `skip`, `override`             |
| `--delete-missing-notebooks` | Reserved for push (currently inert while push is deferred)         |
| `--prune`                    | Delete local directories/files for projects that no longer exist   |
| `--dry-run`                  | Show what would be synced without writing anything                 |
| `-o, --output <format>`      | Output format: `json`, `llm`                                       |

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

State lives in `.deepnote-sync.json` in the synced directory: a map of project id → local directory,
the notebook filenames last synced, the last-synced `metadata.modifiedAt`, and a content hash.
Projects are tracked by id because names (projects and folders) are **not unique** in Deepnote —
cloud renames become local directory moves, and path collisions get a deterministic ` (<short id>)`
suffix.

A project export is a ZIP of one `.deepnote` document per notebook; the documents are deterministic
(the ZIP container is not), so the content hash is computed over the documents, not the archive.
Comparing the local files and a fresh export against the last-synced hash yields:

- both match → unchanged
- only cloud changed → pull (write the notebook files; delete files for notebooks removed in the
  cloud)
- only local changed → `push-deferred` (local edits are kept, not sent; pushing is not yet
  available)
- both changed → conflict → keep the cloud version or skip (per `--on-conflict`; `ask` degrades to
  skip when there is no terminal)

With `--all-files`, each project's working-directory files are downloaded into a `.files/`
subdirectory of the project directory, incrementally (by inventory `size`/`updatedAt`). Files are
download-only; sync does not upload working-directory files.

## Boundaries

- Sync never creates or deletes cloud projects. Local-only `.deepnote` files are reported and left
  alone (use `deepnote open` to import one).
- Local files are never deleted unless `--prune` is passed.
- Push is deferred: `deepnote sync` will not modify a cloud project's notebooks. Edit in Deepnote,
  or re-pull to discard local changes.
- Git is not involved: sync writes ordinary files; commit/branch/push yourself.

**Exit codes:** `0` success (skipped conflicts and deferred pushes included), `1` one or more
projects failed, `2` invalid usage (missing token, bad arguments).
