---
name: deepnote
description: >-
  Work with Deepnote project files (.deepnote). Use when creating, editing,
  or understanding .deepnote files — YAML-based notebook projects containing
  Python code, SQL queries, markdown, visualizations, and input widgets.
  Covers file structure, block types, database integrations, snapshots,
  and CLI usage.
---

# Deepnote Skill

`.deepnote` files are YAML-based, portable, git-friendly project files that can contain multiple notebooks. Each notebook holds an ordered list of blocks (code, SQL, markdown, inputs, visualizations, etc.). Snapshot files (`.snapshot.deepnote`) use the same format but include execution outputs.

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
| `sortingKey` | Determines display order (lexicographic, e.g. `a0`, `a1`, `a2`) |
| `metadata`   | Type-specific configuration object                              |

### Block Types

| Category    | Types                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Code**    | `code`                                                                                                                               |
| **SQL**     | `sql`                                                                                                                                |
| **Text**    | `markdown`, `text-cell-h1`, `text-cell-h2`, `text-cell-h3`, `text-cell-p`, `text-cell-bullet`, `text-cell-todo`, `text-cell-callout` |
| **Input**   | `input-text`, `input-textarea`, `input-checkbox`, `input-select`, `input-slider`, `input-date`, `input-date-range`, `input-file`     |
| **Display** | `visualization`, `big-number`, `image`, `separator`                                                                                  |
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
  my-project_<uuid>_latest.snapshot.deepnote
  my-project_<uuid>_2025-01-08T10-30-00.snapshot.deepnote
```

**Naming:** `{slug}_{projectId}_{timestamp}.snapshot.deepnote`

- `slug` — slugified project name
- `projectId` — UUID from `project.id`
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

1. **IDE environment** — check for a `deepnote.json` file in `.vscode/`, `.cursor/`, or `.agent/` (see IDE Environment Detection below) and use its `venvPath`
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

### IDE Environment Detection

The Deepnote extension for VS Code, Cursor, and Antigravity creates a virtual environment for each project. Before running, check if an IDE-configured environment exists so the CLI uses the same Python interpreter.

Look for a `deepnote.json` file in these directories (in order):

- `.vscode/deepnote.json`
- `.cursor/deepnote.json`
- `.agent/deepnote.json` (Antigravity)

The file maps project IDs to virtual environments:

```json
{
  "mappings": {
    "<project-id>": {
      "environmentId": "<env-id>",
      "venvPath": "/path/to/deepnote-envs/<env-id>"
    }
  }
}
```

To use the IDE environment:

1. Read the `project.id` from the `.deepnote` file
2. Check each `deepnote.json` for a matching key in `mappings`
3. If found, pass the `venvPath` to the CLI with `--python`:

```bash
deepnote run project.deepnote --python /path/to/deepnote-envs/<env-id>
```

If no IDE environment is found, omit `--python` and the CLI will use the system Python.

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

## CLI Quick Reference

| Command                               | Description                                                |
| ------------------------------------- | ---------------------------------------------------------- |
| `deepnote run [path]`                 | Execute notebooks (.deepnote, .ipynb, .py, .qmd)           |
| `deepnote convert <path>`             | Convert between formats (Jupyter, Quarto, Percent, Marimo) |
| `deepnote inspect [path]`             | Display file metadata                                      |
| `deepnote cat <path>`                 | Display block contents                                     |
| `deepnote diff <a> <b>`               | Compare two files                                          |
| `deepnote validate <path>`            | Schema validation                                          |
| `deepnote lint <path>`                | Check for issues (variables, integrations, inputs)         |
| `deepnote stats <path>`               | Project statistics                                         |
| `deepnote analyze <path>`             | Comprehensive analysis with quality score                  |
| `deepnote dag show\|vars\|downstream` | Dependency analysis                                        |
| `deepnote open <path>`                | Open in Deepnote Cloud                                     |

### CLI Command References

- [Run command](references/cli-run.md)
- [Convert command](references/cli-convert.md)
- [Analysis commands](references/cli-analysis.md)
- [Utility commands](references/cli-utility.md)
