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

See [references/file-format.md](references/file-format.md) for complete field descriptions.

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

See [references/block-types.md](references/block-types.md) for metadata fields and YAML examples for each type.

## Integrations

Database connections stored in the top-level `integrations` array:

```yaml
integrations:
  - id: 084f5334-5dbe-41c7-9020-3f66b9418062
    name: Production DB
    type: pgsql
```

Each integration has `id` (UUID), `name`, and `type`. Supported types: `alloydb`, `athena`, `big-query`, `clickhouse`, `databricks`, `dremio`, `mariadb`, `materialize`, `mindsdb`, `mongodb`, `mysql`, `pandas-dataframe`, `pgsql`, `redshift`, `snowflake`, `spanner`, `sql-server`, `trino`.

SQL blocks reference integrations via `metadata.sql_integration_id`.

## Snapshots

Snapshot files (`.snapshot.deepnote`) are `.deepnote` files with execution outputs populated. They keep your source files output-free.

- **Naming:** `{project-name}_{project-id}_{timestamp}.snapshot.deepnote`
- **Latest:** `_latest` snapshot accumulates most recent output per block
- **Timestamped:** Capture point-in-time full execution state
- **Code provenance:** Each block's `contentHash` (SHA-256) verifies which code produced the output

## Editing Guidelines

When creating or modifying `.deepnote` files:

1. **Block IDs** - Generate random 32-character hex strings (e.g. `crypto.randomUUID().replace(/-/g, '')`)
2. **Block groups** - Each block needs a `blockGroup` (same hex format); blocks in the same group share a group ID
3. **Sorting keys** - Use lexicographic strings: `a0`, `a1`, ..., `a9`, `b0`, etc. Insert between existing keys for ordering
4. **Content** - Use YAML literal block scalar (`|`) for multi-line content to preserve newlines
5. **Metadata** - Use `{}` for defaults; add type-specific fields as needed

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

See [references/cli-commands.md](references/cli-commands.md) for full options and examples.
