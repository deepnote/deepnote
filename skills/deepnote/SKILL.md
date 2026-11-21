---
name: deepnote
description: >-
  Work with Deepnote project files (.deepnote). Use when creating, editing,
  or understanding .deepnote files — YAML-based notebook projects containing
  Python code, SQL queries, markdown, visualizations, and input widgets.
  Also use when building or publishing Deepnote data apps or Streamlit apps, choosing a runtime,
  or using the Deepnote CLI to run, sync, or publish project files.
---

# Deepnote Skill

`.deepnote` files are YAML-based, portable, git-friendly files that each hold a single notebook. Each notebook holds an ordered list of blocks (code, SQL, markdown, inputs, visualizations, etc.). Snapshot files (`.snapshot.deepnote`) use the same format but include execution outputs.

## File Structure

A minimal valid `.deepnote` file:

```yaml
version: 1.0.0
metadata:
  createdAt: "2025-01-08T10:00:00.000Z"
project:
  id: 2e814690-4f02-465c-8848-5567ab9253b7
  name: My Project
  notebooks:
    - id: e132b172-b114-410e-8331-011517db664f
      name: Main
      blocks:
        - id: b75d3ada977549b29f4c7f2183d52fcf
          blockGroup: 9dd9578e604a4235a552d1f4a53336ee
          type: code
          content: |
            print("Hello World!")
          sortingKey: a0
          metadata: {}
```

**Top-level fields:** `version` (required, "1.0.0"), `metadata` (required), `project` (required), `integrations` (optional), `environment` (optional).

### Schema Reference

- [TypeScript schema](references/schema.ts) — auto-generated types for .deepnote and .snapshot.deepnote files

## Notebooks

Each entry in `project.notebooks` has:

- `id` - UUID v4 identifier
- `name` - Human-readable name
- `executionMode` - `block` (run individually) or `downstream` (run with dependents)
- `blocks` - Array of content blocks
- `workingDirectory` - Optional base directory for file operations

## Blocks

Every block has these common fields:

| Field        | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `id`         | Unique hex identifier (32 chars)                                |
| `blockGroup` | Groups related blocks (same format as id)                       |
| `type`       | Block type string                                               |
| `content`    | Source code, text, or query (YAML multi-line `\|` syntax)       |
| `sortingKey` | Display and run order by character code (e.g. `a0`, `a1`, `a2`) |
| `metadata`   | Type-specific configuration object                              |

### Block Types

| Category    | Types                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Code**    | `code`                                                                                                                               |
| **SQL**     | `sql`                                                                                                                                |
| **Text**    | `markdown`, `text-cell-h1`, `text-cell-h2`, `text-cell-h3`, `text-cell-p`, `text-cell-bullet`, `text-cell-todo`, `text-cell-callout` |
| **Input**   | `input-text`, `input-textarea`, `input-checkbox`, `input-select`, `input-slider`, `input-date`, `input-date-range`, `input-file`     |
| **Display** | `visualization`, `pivot-table`, `big-number`, `image`, `separator`                                                                   |
| **Other**   | `button`, `notebook-function`                                                                                                        |

### Block Type References

- [Code and SQL blocks](references/blocks-code-and-sql.md)
- [Text blocks](references/blocks-text.md)
- [Input blocks](references/blocks-input.md)
- [Display and action blocks](references/blocks-display.md)

## Integrations

Database connections stored in the top-level `integrations` array:

```yaml
integrations:
  - id: 084f5334-5dbe-41c7-9020-3f66b9418062
    name: Production DB
    type: pgsql
```

Each integration has `id` (UUID), `name`, and `type`. Supported types: `alloydb`, `athena`, `big-query`, `clickhouse`, `databricks`, `dremio`, `mariadb`, `materialize`, `mindsdb`, `mongodb`, `mysql`, `pgsql`, `redshift`, `snowflake`, `spanner`, `sql-server`, `trino`. (Note: `pandas-dataframe` exists as a type but is not configurable via CLI.)

SQL blocks reference integrations via `metadata.sql_integration_id`.

## Snapshots

Snapshot files (`.snapshot.deepnote`) store execution outputs separately from source.

### Location

Snapshots are saved in a `snapshots/` directory adjacent to the source file:

```text
project.deepnote
snapshots/
  my-project_<projectId>_<notebookId>_latest.snapshot.deepnote
  my-project_<projectId>_<notebookId>_2025-01-08T10-30-00.snapshot.deepnote
  my-project_<projectId>_latest.snapshot.deepnote
  my-project_<projectId>_2025-01-08T10-30-00.snapshot.deepnote
```

**Naming:**

- Single-notebook files: `{slug}_{projectId}_{notebookId}_{timestamp}.snapshot.deepnote`
- Legacy files: `{slug}_{projectId}_{timestamp}.snapshot.deepnote`

- `slug` — slugified project name
- `projectId` — UUID from `project.id`
- `notebookId` — notebook UUID (for single-notebook files)
- `timestamp` — `latest` or ISO 8601 (e.g. `2025-01-08T10-30-00`)

### Reading Snapshot Data (token-efficient)

Use CLI commands — they're cross-platform and avoid loading the full YAML:

```bash
deepnote cat snapshots/*_latest.snapshot.deepnote                    # All block outputs
deepnote cat snapshots/*_latest.snapshot.deepnote --type code        # Only code outputs
deepnote inspect snapshots/*_latest.snapshot.deepnote                # Metadata + summary
deepnote inspect snapshots/*_latest.snapshot.deepnote -o json        # JSON for parsing
```

Do not read snapshot files directly — always use CLI commands or MCP tools to inspect them.

### Diagnosing Errors

When execution fails, check the latest snapshot:

1. `execution.summary` — `blocksExecuted`, `blocksSucceeded`, `blocksFailed`, `totalDurationMs`
2. `execution.error` — `name`, `message`, `traceback` (top-level error)
3. Per-block outputs — individual blocks have `error` output_type with `ename`, `evalue`, `traceback`

Quick error check:

```bash
deepnote inspect snapshots/*_latest.snapshot.deepnote -o json
deepnote run project.deepnote -o json   # Errors inline in output
```

### Content Hash Verification

Each block in a snapshot has `contentHash` (SHA-256). If block content changed since the snapshot, the hash won't match — the output is stale.

### Latest vs Timestamped

| Aspect      | `_latest`                           | Timestamped            |
| ----------- | ----------------------------------- | ---------------------- |
| Updated     | Overwritten on each run             | Immutable, one per run |
| Consistency | May mix outputs from different runs | All from same run      |
| Use case    | Quick access to recent results      | Audit trail            |

## Editing Guidelines

When creating or modifying `.deepnote` files:

1. **Block IDs** - Generate random 32-character hex strings (e.g. `crypto.randomUUID().replace(/-/g, '')`)
2. **Block groups** - Each block needs a `blockGroup` (same hex format); blocks in the same group share a group ID
3. **Sorting keys** - Use lexicographic strings: `a0`, `a1`, ..., `a9`, `b0`, etc. Insert between existing keys for ordering
4. **Content** - Use YAML literal block scalar (`|`) for multi-line content to preserve newlines
5. **Metadata** - Use `{}` for defaults; add type-specific fields as needed

## Important Policies

- **Stay in .deepnote format.** When something goes wrong, do not fall back to converting to `.ipynb` and working in Jupyter format. The `.deepnote` format has better debugging tools (`deepnote inspect`, `deepnote cat`, `deepnote lint`, `deepnote dag`) that are not available for `.ipynb` files. Stay in `.deepnote` and use these tools to diagnose and fix issues.
- **Only convert on explicit request.** Only use `deepnote convert` to export when the user explicitly asks for a format conversion.

## Running After Edits

After creating or modifying blocks, **always** run the project to verify changes.

### Prerequisites

Check if the CLI is installed:

```bash
deepnote --version
```

If not installed, find the best available Python and install via pip:

1. **IDE interpreter** — check for a `deepnote.json` file in `.vscode/`, `.cursor/`, or `.antigravity/` (see IDE Interpreter Detection below) and use its `pythonInterpreter` (or, for older sidecars without one, the interpreter inside `venvPath`)
2. **Project instructions** — if the project has a `.python-version` file or `pyproject.toml` with `requires-python`, use the specified version
3. **Project venv** — look for `.venv/bin/python`, `venv/bin/python`, or `env/bin/python`
4. **Homebrew Python** — check if `/opt/homebrew/bin/python3` or `brew --prefix python3` exists
5. **System Python** — use `python3` (preferred) or `python`

Install with the best available Python (must be >= 3.9):

```bash
<best-python> -m pip install deepnote-cli
```

If no suitable Python is available, install via npm instead:

```bash
npm install -g @deepnote/cli
```

### IDE Interpreter Detection

The Deepnote extension for VS Code, Cursor, and Antigravity records the interpreter selected for each notebook in a `deepnote.json` sidecar file in the workspace root:

- `.vscode/deepnote.json`
- `.cursor/deepnote.json`
- `.antigravity/deepnote.json` (Antigravity)

The file maps project IDs to interpreters:

```json
{
  "mappings": {
    "<project-id>": {
      "pythonInterpreter": "/path/to/python"
    }
  }
}
```

Older extension versions managed a virtual environment per project and also recorded `environmentId` and `venvPath` for it; both are optional, and `venvPath` is only used as a fallback when no `pythonInterpreter` is recorded. Both shapes are pinned as fixtures in `test-fixtures/ide-sidecar/`.

`deepnote run`, `analyze`, `lint`, `dag`, and the MCP `deepnote_run` tool read this file automatically: when `--python` / `pythonPath` and `DEEPNOTE_PYTHON` are both unset, they look the file's `project.id` up in every `deepnote.json` from the notebook's directory upward, plus the extra roots each tool searches (`DEEPNOTE_WORKSPACE` for the CLI, plus `--cwd` for `run` only; the workspace root, `DEEPNOTE_WORKSPACE` or the server's cwd, for the MCP server), and use the recorded interpreter. You do not need to pass `--python` for a notebook whose interpreter is already selected in the extension. The output says which interpreter was used and where it came from (`source: ide`).

Pass `--python` only to override that choice. To install `deepnote-cli` into the same environment, use the interpreter the tools resolved (`deepnote run` prints it): the sidecar's `pythonInterpreter`, or for an older sidecar without one, the interpreter inside its `venvPath`:

```bash
<resolved-python> -m pip install deepnote-cli
```

At run time the full order is: `--python` / `pythonPath`, then `DEEPNOTE_PYTHON`, then the IDE environment above, then a `.venv` or `venv` directory from the notebook's directory upward that has `deepnote-toolkit` installed (`source: venv`; one without the toolkit is skipped with a warning rather than picked), then the system Python. The installation checklist earlier in this section is only about where to install `deepnote-cli`; it does not affect which interpreter a run uses.

### Running

```bash
deepnote run project.deepnote                         # Run full project
deepnote run project.deepnote --notebook "Analysis"    # Specific notebook
deepnote run project.deepnote --block abc123           # Specific block
deepnote run project.deepnote --dry-run                # Preview only
deepnote run project.deepnote -o json                  # JSON output
```

### Checking Results

1. **Inline output** — stdout/stderr printed directly
2. **Snapshot** — outputs saved to `snapshots/` directory (see Snapshots section above)
3. **Exit codes** — 0 success, 1 runtime error, 2 invalid usage
4. **JSON** — use `-o json` for structured per-block results

### Workflow

1. Edit the `.deepnote` file
2. Run: `deepnote run project.deepnote`
3. If errors, check snapshot for details
4. Fix and re-run

## Data apps and Streamlit apps

Use a **data app** for an HTML, CSS, and JavaScript page hosted by Deepnote, and a **Streamlit app**
for a Python UI. The recipes below are the whole happy path. Read
[Build and publish data apps and Streamlit apps](references/apps.md) and
[Publish data apps and Streamlit apps](references/cli-publish.md) before going beyond them —
choosing between the two, the local-server workflow, the viewer API, sync workspaces, and failure
handling are there.

### Publish a data app

A data app needs a **data app project**. `deepnote publish` refuses any other project type with exit
code 2, and a `.deepnote` file cannot create one. Set `DEEPNOTE_TOKEN` in the environment or a local
`.env` first.

```bash
# 1. Build into a dedicated directory; everything inside it is uploaded
npm run build                                   # produces ./dist

# 2. First publish: create the data app project, and record the project ID it prints
deepnote publish ./dist --create "Revenue review"

# 3. Every publish after that targets the project created in step 2
deepnote publish ./dist --project-id <uuid>
```

Every `--create` makes another project, so reuse `--project-id` rather than creating one per
publish. `publish` refuses a build directory holding a `.env` or `.env.*` file at any depth, or a
file over 100 MiB. Use `--prune` to delete remote files no longer in the build.

Then open the URL it prints, signed in as a viewer with project access, and check the assets,
navigation, and any notebook runs on that hosted page. The build must follow these rules:

- **No local server.** A published data app is static files plus the browser — no `serveStatic`
  routes and no Python. Replace local API calls before publishing a build that had them.
- **Exact filenames.** `/`, and any path ending in `/`, serves that directory's `index.html`. Every
  other path is an exact filename, so link to `about.html`, not `/about`.
- **No tokens in the build.** A page that runs notebooks asks the Deepnote shell for a viewer token
  over `postMessage`; see [viewer API access](references/apps.md#add-viewer-api-access). A local
  preview with a personal token does not test viewer permissions or token refresh.

A data app project holds exactly one notebook, and `publish` prints its ID. A page that starts runs
must name that ID. Put a local notebook into the project with
`deepnote run <file> --cloud --notebook-id <id> --push --yes`.

### Publish a Streamlit app

This command installs nothing, and uploads nothing unless you pass `--upload`, which uploads the
entrypoint from the current directory first. Put the third-party packages the entrypoint imports in
the project's `requirements.txt`, which the Init notebook installs on every machine start — an
ad-hoc `!pip install` is gone after the restart below. The entrypoint's local dependencies must
already be in the project's Files, and so must the entrypoint without `--upload`; the paths are
project-relative:

```bash
deepnote streamlit publish apps/dashboard.py --project-id <uuid>
deepnote streamlit publish apps/dashboard.py --project-id <uuid> --upload
```

Creating a new Streamlit app restarts the project machine; re-publishing an existing entrypoint does
not, so a package added afterwards reaches the app only when the project's shared machine restarts —
never from a notebook or terminal install, which in a privately-run project lands on your own
machine instead. Never delete and re-upload an entrypoint to change it: that drops the app
registration and the next publish returns a new URL. To change an entrypoint, publish again with
`--upload`, or upload the edited file to the same path in the project's Files in Deepnote; both keep
the app and its URL. Through the MCP server, upload with `write_file` and `overwrite`, or Deepnote
writes a uniquely named copy and the app goes on serving the old file. Open the printed URL and test it as the intended viewer.

Apps published from notebook blocks are deprecated; do not build new ones.

## CLI Quick Reference

| Command                                       | Description                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepnote run [path]`                         | Execute notebooks (.deepnote, .ipynb, .py, .qmd)                                                                                                                                                                                                                                                    |
| `deepnote convert <path>`                     | Convert between formats (Jupyter, Quarto, Percent, Marimo)                                                                                                                                                                                                                                          |
| `deepnote inspect [path]`                     | Display file metadata                                                                                                                                                                                                                                                                               |
| `deepnote cat <path>`                         | Display block contents                                                                                                                                                                                                                                                                              |
| `deepnote diff <a> <b>`                       | Compare two files                                                                                                                                                                                                                                                                                   |
| `deepnote validate <path>`                    | Schema validation                                                                                                                                                                                                                                                                                   |
| `deepnote lint [path]`                        | Check a .deepnote or integrations yaml file for issues                                                                                                                                                                                                                                              |
| `deepnote stats <path>`                       | Project statistics                                                                                                                                                                                                                                                                                  |
| `deepnote analyze <path>`                     | Comprehensive analysis with quality score                                                                                                                                                                                                                                                           |
| `deepnote dag show\|vars\|downstream`         | Dependency analysis                                                                                                                                                                                                                                                                                 |
| `deepnote split <path>`                       | Split a multi-notebook file into one `.deepnote` per notebook. The init notebook (if any) becomes its own standalone file; each main file keeps `initNotebookId` so `deepnote run` resolves and runs the sibling init as a prelude.                                                                 |
| `deepnote open <path>`                        | Open in Deepnote Cloud                                                                                                                                                                                                                                                                              |
| `deepnote schedule <path>`                    | Create, update, or remove (`--remove`) a notebook's recurring Deepnote Cloud schedule                                                                                                                                                                                                               |
| `deepnote publish <dir>`                      | Publish a build directory as a data app. Needs a data app project; `--create <name>` makes one.                                                                                                                                                                                                     |
| `deepnote unpublish`                          | Make a data app editor-only again without changing its files.                                                                                                                                                                                                                                       |
| `deepnote streamlit publish <file>`           | Serve a project file as a Streamlit app, optionally uploading it first.                                                                                                                                                                                                                             |
| `deepnote sync [dir]`                         | Sync Deepnote Cloud projects with a local directory, both ways: pull every project into `<folder path>/<project name>/` (one `.deepnote` per notebook), push local edits back (the exact-inverse ZIP import). State in `.deepnote-sync.json`; conflicts prompt (or `--on-conflict skip\|override`). |
| `deepnote integrations pull\|add\|edit\|auth` | Manage database integrations in the local integrations file (`pull`, `add`, `edit`); `auth` authenticates a `big-query` + Google OAuth integration for local `deepnote run`, storing its token under `~/.deepnote/` instead                                                                         |

### CLI Command References

- [Run command](references/cli-run.md)
- [Schedule command](references/cli-schedule.md)
- [Publish commands](references/cli-publish.md)
- [Convert command](references/cli-convert.md)
- [Sync command](references/cli-sync.md)
- [Analysis commands](references/cli-analysis.md)
- [Integrations commands](references/cli-integrations.md)
- [Utility commands](references/cli-utility.md)
