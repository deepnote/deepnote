# Deepnote File Formats

This document describes the file formats used by Deepnote for storing notebooks, projects, and execution snapshots.

## Overview

Deepnote uses two primary file types:

| Format                | Extension            | Purpose                                                    |
| --------------------- | -------------------- | ---------------------------------------------------------- |
| **Deepnote Project**  | `.deepnote`          | Source file containing code, markdown, and configuration   |
| **Deepnote Snapshot** | `.snapshot.deepnote` | Point-in-time capture of a notebook execution with outputs |

Both formats are YAML-based, human-readable, and designed to be Git-friendly.

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

| Field        | Description                                     |
| ------------ | ----------------------------------------------- |
| `id`         | Unique identifier                               |
| `blockGroup` | Groups related blocks together                  |
| `type`       | Block type (see table below)                    |
| `content`    | The source code, markdown text, or query        |
| `sortingKey` | Determines display order                        |
| `metadata`   | Execution timing and other metadata             |
| `outputs`    | Execution outputs (when snapshots are disabled) |

### Block Types

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

## The `.snapshot.deepnote` Format

Snapshot files capture the complete state of a notebook execution, providing reproducibility and execution history.

### What is a Snapshot?

A snapshot is a complete `.deepnote` file that represents a **point-in-time capture** of a notebook execution. It includes:

- All code and configuration from the source file
- Complete execution outputs from all blocks
- Metadata about when and where it was executed
- Environment information for reproducibility

### Why Use Snapshots?

| Benefit               | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| **Clean Git history** | Your `.deepnote` files only change when code changes, not when outputs change |
| **Execution history** | Review what outputs looked like at different points in time                   |
| **Reproducibility**   | Each snapshot captures everything needed to understand a run                  |
| **Collaboration**     | Share specific execution states with teammates                                |

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

The `_latest.snapshot.deepnote` file always contains the most recent outputs for every block. When you run blocks:

1. Outputs are written to the `latest` snapshot
2. A timestamped copy is created for history
3. The main `.deepnote` file remains output-free

### Snapshot Structure

A snapshot has the same structure as a `.deepnote` file, with outputs populated:

```yaml
version: 1.0.0
metadata:
  createdAt: "2025-01-08T10:30:00.000Z"
  modifiedAt: "2025-01-08T10:30:00.000Z"
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
