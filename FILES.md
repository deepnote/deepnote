# Deepnote File Formats

This document describes the file formats used by Deepnote for storing notebooks, projects, and execution snapshots.

## Overview

Deepnote uses two primary file types:

| File                  | Extension            | Purpose                                                  |
| --------------------- | -------------------- | -------------------------------------------------------- |
| **Deepnote Project**  | `.deepnote`          | Source file containing code, markdown, and configuration |
| **Deepnote Snapshot** | `.snapshot.deepnote` | A `.deepnote` file with execution outputs populated      |

Both use the same YAML-based format. A snapshot is simply a `.deepnote` file that includes block outputs and execution metadata, stored separately to keep your source files output-free.

## The `.deepnote` Format

A `.deepnote` file is a portable, self-contained project file that can include multiple notebooks, environment configuration, and integrations.

For the complete schema definition, see [`deepnote-file-schema.ts`](https://github.com/deepnote/deepnote/blob/main/packages/blocks/src/deserialize-file/deepnote-file-schema.ts).

### Key Features

- **Portable**: Everything needed to understand and run the project is in one file
- **Git-friendly**: YAML format produces meaningful diffs
- **Multi-notebook**: A single project can contain multiple notebooks
- **Environment-aware**: Can include Python version, packages, and other dependencies
- **Integration-ready**: Stores database connections and other integrations

### Structure

```yaml
version: 1.0.0
metadata:
  createdAt: "2025-01-08T10:00:00.000Z"
  modifiedAt: "2025-01-08T12:30:00.000Z"
project:
  id: 2e814690-4f02-465c-8848-5567ab9253b7
  name: My Analysis Project
  notebooks:
    - id: e132b172-b114-410e-8331-011517db664f
      name: Data Exploration
      executionMode: block
      blocks:
        - id: b75d3ada977549b29f4c7f2183d52fcf
          blockGroup: 9dd9578e604a4235a552d1f4a53336ee
          type: code
          content: |
            import pandas as pd
            print("Hello World!")
          sortingKey: a0
          metadata: {}
          outputs: []
  settings: {}
integrations:
  - id: 084f5334-5dbe-41c7-9020-3f66b9418062
    name: Production Database
    type: pgsql
```

### Top-Level Fields

| Field          | Required | Description                                |
| -------------- | -------- | ------------------------------------------ |
| `version`      | Yes      | Schema version (currently `1.0.0`)         |
| `metadata`     | Yes      | File timestamps and other metadata         |
| `project`      | Yes      | The project definition with notebooks      |
| `integrations` | No       | Database connections and external services |
| `environment`  | No       | Python version and package dependencies    |

### Notebooks

Each notebook in `project.notebooks` contains:

| Field              | Description                           |
| ------------------ | ------------------------------------- |
| `id`               | Unique UUID v4 identifier             |
| `name`             | Human-readable notebook name          |
| `executionMode`    | How blocks execute (`block` or `all`) |
| `blocks`           | Array of content blocks               |
| `workingDirectory` | Base directory for file operations    |

### Blocks

Blocks are the fundamental units of content. Each block has:

| Field         | Description                                     |
| ------------- | ----------------------------------------------- |
| `id`          | Unique identifier                               |
| `blockGroup`  | Groups related blocks together                  |
| `type`        | Block type (see table below)                    |
| `content`     | The source code, markdown text, or query        |
| `contentHash` | SHA-256 hash of the `content` field (optional)  |
| `sortingKey`  | Determines display order                        |
| `metadata`    | Execution timing and other metadata             |
| `outputs`     | Execution outputs (when snapshots are disabled) |

### Block Types

Common block types include:

| Type            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `code`          | Python code cells                                    |
| `markdown`      | Rich text documentation using Markdown               |
| `sql`           | SQL queries against database integrations            |
| `visualization` | Charts and graphs (Vega-Lite based)                  |
| `dataframe`     | Interactive DataFrame explorer                       |
| `image`         | Embedded images                                      |
| `input`         | Interactive input widgets (sliders, dropdowns, etc.) |
| `text-cell-h1`  | Heading level 1 text block                           |
| `text-cell-h2`  | Heading level 2 text block                           |
| `text-cell-h3`  | Heading level 3 text block                           |
| `text-cell-p`   | Paragraph text block                                 |

For the complete list of block types, see the [block type schema](https://github.com/deepnote/deepnote/blob/main/packages/blocks/src/deserialize-file/deepnote-file-schema.ts#L371-L399).

### Outputs

Outputs follow the Jupyter output format:

```yaml
outputs:
  # Stream output (stdout/stderr)
  - name: stdout
    output_type: stream
    text: |
      Hello World!

  # Rich display output
  - data:
      text/plain: "<DataFrame with 100 rows>"
      text/html: "<table>...</table>"
      application/vnd.deepnote.dataframe.v3+json:
        columns: [...]
        rows: [...]
    output_type: execute_result
    execution_count: 1

  # Error output
  - ename: ValueError
    evalue: "invalid input"
    output_type: error
    traceback:
      - "Traceback (most recent call last):"
      - "..."
```

## Snapshots (`.snapshot.deepnote`)

A snapshot is a `.deepnote` file with execution outputs populated. It uses the same format as your source file, but includes block outputs and execution metadata.

### What is a Snapshot?

Snapshots store execution outputs separately from your source code. The `_latest` snapshot accumulates outputs as you run blocks, always containing the most recent output for each block. It includes:

- All code and configuration from the source file
- Execution outputs from blocks (updated incrementally as blocks run)
- Metadata about when blocks were executed
- Environment information (the `environment` field is **required** in snapshot files)

Each block's `contentHash` lets you verify whether the code that produced an output matches the current code.

### Why Use Snapshots?

| Benefit               | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| **Clean Git history** | Your `.deepnote` files only change when code changes, not when outputs change |
| **Execution history** | Review what outputs looked like at different points in time                   |
| **Code provenance**   | `contentHash` verifies which code version produced each output                |
| **Collaboration**     | Share specific execution states with teammates                                |

> **Note:** Snapshots capture code provenance (via `contentHash`) but not data provenance. If external data sources change between runs, outputs may differ even with identical code.

### Directory Structure

When snapshots are enabled, they're stored in a `snapshots/` folder alongside your project:

```
my-project/
├── customer-analysis.deepnote          # Source file (no outputs)
├── data-pipeline.deepnote              # Another source file
└── snapshots/
    ├── customer-analysis_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote
    ├── customer-analysis_2e814690-4f02-465c-8848-5567ab9253b7_2025-01-08T10-30-00.snapshot.deepnote
    └── data-pipeline_a1b2c3d4-5678-90ab-cdef-1234567890ab_latest.snapshot.deepnote
```

### Naming Convention

Snapshot files follow this pattern:

```
{project-name}_{project-id}_{timestamp}.snapshot.deepnote
```

| Component      | Description                 | Example                                |
| -------------- | --------------------------- | -------------------------------------- |
| `project-name` | Slugified project name      | `customer-analysis`                    |
| `project-id`   | Full UUID v4 of the project | `2e814690-4f02-465c-8848-5567ab9253b7` |
| `timestamp`    | ISO 8601 format or `latest` | `2025-01-08T10-30-00` or `latest`      |

**Examples:**

```
customer-analysis_2e814690-4f02-465c-8848-5567ab9253b7_latest.snapshot.deepnote
customer-analysis_2e814690-4f02-465c-8848-5567ab9253b7_2025-01-08T10-30-00.snapshot.deepnote
```

### The `latest` Snapshot

The `_latest.snapshot.deepnote` file accumulates outputs as you run blocks, always containing the most recent output for each block. When you run a block:

1. Its output is written to the `latest` snapshot (replacing any previous output for that block)
2. A timestamped copy is created for history
3. The main `.deepnote` file remains output-free

This means the `latest` snapshot may contain outputs from blocks run at different times, not necessarily from a single execution run.

### Timestamped Snapshots

Unlike the `latest` snapshot which accumulates outputs over time, timestamped snapshots capture a **point-in-time execution** of the entire notebook. When you run all blocks in a notebook (or trigger a full execution), a timestamped snapshot is created that represents that specific run.

**Key differences:**

| Aspect          | `latest` Snapshot                                  | Timestamped Snapshot                       |
| --------------- | -------------------------------------------------- | ------------------------------------------ |
| **Creation**    | Updated incrementally as individual blocks run     | Created from a complete notebook execution |
| **Consistency** | May contain outputs from different execution times | All outputs from the same execution run    |
| **Purpose**     | Quick access to most recent state                  | Historical record of a specific run        |
| **Overwriting** | Always overwritten with new outputs                | Immutable once created                     |

**Example workflow:**

1. You run block A at 10:00 AM → `latest` snapshot updated
2. You run block B at 10:15 AM → `latest` snapshot updated again
3. You run all blocks at 10:30 AM → New timestamped snapshot created: `project_id_2025-01-08T10-30-00.snapshot.deepnote`

The timestamped snapshot from step 3 contains a coherent execution state where all outputs were produced together, while the `latest` snapshot may contain block A's output from 10:00 and block B's output from 10:15.

### Snapshot Structure

Since a snapshot is a `.deepnote` file, it has the same structure — just with `outputs` and `contentHash` populated:

```yaml
version: 1.0.0
metadata:
  createdAt: "2025-01-08T10:30:00.000Z"
  modifiedAt: "2025-01-08T10:30:00.000Z"
  snapshotHash: sha256:def456... # top-level hash for quick comparison
project:
  id: 2e814690-4f02-465c-8848-5567ab9253b7
  name: Customer Analysis
  notebooks:
    - id: e132b172-b114-410e-8331-011517db664f
      name: Main Notebook
      blocks:
        - id: block-1
          type: code
          content: |
            import pandas as pd
            df = pd.read_csv('data.csv')
            df.head()
          contentHash: sha256:a1b2c3... # hash of the content field
          metadata:
            execution_start: 1704710400000
            execution_millis: 150
            execution_context_id: ctx-123
          executionCount: 1
          outputs:
            - data:
                text/html: "<table>...</table>"
              output_type: execute_result
              execution_count: 1
```

### Snapshot Hash

The `snapshotHash` in metadata provides a single value to quickly check if a snapshot is still in sync with the current code and environment.

**Computed from:**

- All block `contentHash` values across all notebooks
- `environment.hash` (if present)
- `version` (file format version)
- `project.integrations` (id, type, name of each integration)

**Explicitly excluded:**

- Temporal fields (`createdAt`, `modifiedAt`, execution timestamps)
- Execution metadata
- Block inputs
- Block outputs

This means `snapshotHash` answers: _"Has the code, environment, or integrations changed since this snapshot was taken?"_ — without being affected by when blocks were run, data source changes or what outputs the blocks produced.

## Migration Guide

Deepnote provides a CLI tool to convert notebooks from other formats to `.deepnote`.

### Supported Formats

| Format           | Extension | Description                           |
| ---------------- | --------- | ------------------------------------- |
| Jupyter Notebook | `.ipynb`  | Standard Jupyter notebook format      |
| Marimo           | `.py`     | Marimo reactive notebook format       |
| Percent Format   | `.py`     | Python files with `# %%` cell markers |
| Quarto           | `.qmd`    | Quarto markdown notebooks             |

### Using `deepnote-convert`

Install the CLI:

```bash
npm install -g @deepnote/convert
```

Convert a notebook:

```bash
deepnote-convert notebook.ipynb -o notebook.deepnote
deepnote-convert marimo_notebook.py -o notebook.deepnote
deepnote-convert script.py -o notebook.deepnote  # percent format
deepnote-convert document.qmd -o notebook.deepnote
```

For more details, see the [`@deepnote/convert` documentation](https://github.com/deepnote/deepnote/blob/main/packages/convert/README.md).

## FAQ

### Why YAML instead of JSON?

YAML produces cleaner diffs when reviewing changes in Git. Multi-line strings (code cells) are more readable, and the format supports comments for documentation.

### Can I have multiple notebooks in one file?

Yes! A `.deepnote` file is a project that can contain multiple notebooks. Each notebook has its own ID and can be executed independently.

### How do I share a specific execution state?

Share the timestamped snapshot file. It contains everything needed to see exactly what outputs were produced at that point in time.
