---
title: Introduction to Deepnote YAML file format
description: Learn about the Deepnote file format, its structure, and key differences from Jupyter notebooks.
noIndex: false
noContent: false
---

# Introduction to Deepnote YAML file format, and difference between Deepnote & Jupyter

Deepnote uses a human-readable YAML format (`.deepnote` files) to store notebooks and projects. This format is designed to be version-control friendly, easily readable, and extensible while maintaining compatibility with the Jupyter ecosystem.

## What is a `.deepnote` file?

A `.deepnote` file is a YAML-formatted document that represents an entire Deepnote project, including:

- **Project metadata** (creation date, modification date, version)
- **One or more notebooks** with their blocks and execution state
- **Project settings** (environment configuration, dependencies, integrations)
- **Execution modes** and working directories

Unlike Jupyter's JSON-based `.ipynb` format, Deepnote's YAML format prioritizes human readability and git-friendly diffs, making collaboration and version control significantly easier.

## File structure overview

A typical `.deepnote` file has the following top-level structure:

```yaml
metadata:
  createdAt: "2025-01-27T12:00:00Z"
  modifiedAt: "2025-01-27T14:30:00Z"
  exportedAt: "2025-01-27T15:00:00Z"
  checksum: "abc123..."

version: "1.0.0"

project:
  id: "project-uuid"
  name: "My Data Analysis Project"
  initNotebookId: "notebook-uuid"

  notebooks:
    - id: "notebook-uuid"
      name: "Analysis Notebook"
      blocks: [...]
      executionMode: "block"
      isModule: false
      workingDirectory: "/work"

  integrations:
    - id: "integration-uuid"
      name: "Snowflake Connection"
      type: "snowflake"

  settings:
    environment:
      pythonVersion: "3.11"
      customImage: "my-custom-image:latest"
    requirements:
      - "pandas>=2.0.0"
      - "numpy>=1.24.0"
    sqlCacheMaxAge: 3600
```

## Key components

### Metadata section

The metadata section contains file-level information:

- **`createdAt`**: ISO 8601 timestamp of when the project was created
- **`modifiedAt`**: ISO 8601 timestamp of the last modification
- **`exportedAt`**: ISO 8601 timestamp of when the file was exported
- **`checksum`**: Optional hash for file integrity verification

### Version

The `version` field specifies the Deepnote file format version (e.g., `'1.0.0'`). This ensures backward compatibility as the format evolves.

### Project section

The project section is the core of the file, containing:

#### Project properties

- **`id`**: Unique identifier for the project
- **`name`**: Human-readable project name
- **`initNotebookId`**: Optional ID of the notebook to open by default

#### Notebooks array

Each notebook in the project contains:

- **`id`**: Unique identifier for the notebook
- **`name`**: Notebook name
- **`blocks`**: Array of blocks (code, markdown, SQL, charts, etc.)
- **`executionMode`**: Either `'block'` (execute individual blocks) or `'downstream'` (execute dependent blocks)
- **`isModule`**: Boolean indicating if the notebook is a reusable module
- **`workingDirectory`**: Optional working directory path (defaults to `/work`)

#### Integrations array

Connected data sources and external services:

- **`id`**: Integration identifier
- **`name`**: Human-readable integration name
- **`type`**: Integration type (e.g., `'snowflake'`, `'bigquery'`, `'postgres'`)

#### Settings object

Project-wide configuration:

- **`environment`**: Python version and custom Docker images
- **`requirements`**: Python package dependencies
- **`sqlCacheMaxAge`**: SQL query cache duration in seconds

### Block structure

Each block in a notebook has the following structure:

```yaml
- id: "block-uuid"
  type: "code" # or 'markdown', 'sql', 'chart', 'input', etc.
  sortingKey: "1"
  blockGroup: "group-uuid"
  content: |
    import pandas as pd
    df = pd.read_csv('data.csv')
    df.head()
  executionCount: 1
  version: 1
  metadata:
    custom_field: "value"
  outputs:
    - output_type: "execute_result"
      data:
        text/plain: "..."
```

**Block properties:**

- **`id`**: Unique block identifier
- **`type`**: Block type (`'code'`, `'markdown'`, `'sql'`, `'chart'`, `'input'`, etc.)
- **`sortingKey`**: Base-36 encoded position for ordering blocks
- **`blockGroup`**: Optional grouping identifier for related blocks
- **`content`**: The actual code, markdown, or query content
- **`executionCount`**: Number of times the block has been executed
- **`version`**: Block schema version
- **`metadata`**: Arbitrary key-value pairs for block-specific settings
- **`outputs`**: Array of execution outputs (for code and SQL blocks)

## Deepnote vs. Jupyter: Key differences

While Deepnote maintains compatibility with Jupyter, there are important differences:

### File format

| Feature                | Jupyter (`.ipynb`)    | Deepnote (`.deepnote`)         |
| ---------------------- | --------------------- | ------------------------------ |
| **Format**             | JSON                  | YAML                           |
| **Readability**        | Machine-optimized     | Human-optimized                |
| **Git diffs**          | Noisy, hard to review | Clean, easy to review          |
| **Multiple notebooks** | One file per notebook | Multiple notebooks per project |
| **Project settings**   | Not included          | Included in file               |

### Project-level organization

**Jupyter:**

- Each notebook is a separate `.ipynb` file
- No native project concept
- Dependencies managed separately (e.g., `requirements.txt`)
- No built-in integration management

**Deepnote:**

- Single `.deepnote` file contains entire project
- Multiple notebooks organized together
- Dependencies and settings embedded in the file
- Integration configurations included
- Module system for reusable notebooks

### Block types

**Jupyter:**

- Code cells (Python, R, Julia, etc.)
- Markdown cells
- Raw cells

**Deepnote:**

- All Jupyter cell types supported
- **Additional block types:**
  - SQL blocks with native database connectivity
  - Chart blocks with visual query builder
  - Input blocks for interactive parameters
  - Big number blocks for KPIs
  - Rich text blocks with advanced formatting

### Execution modes

**Jupyter:**

- Sequential execution only
- Cells executed in order or individually

**Deepnote:**

- **Block mode**: Execute blocks independently
- **Downstream mode**: Automatically execute dependent blocks
- Dependency tracking between blocks

### Metadata and settings

**Jupyter:**

```json
{
  "metadata": {
    "kernelspec": {
      "name": "python3",
      "display_name": "Python 3"
    }
  }
}
```

**Deepnote:**

```yaml
project:
  settings:
    environment:
      pythonVersion: "3.11"
      customImage: "custom-image:latest"
    requirements:
      - "pandas>=2.0.0"
    sqlCacheMaxAge: 3600
```

### Output storage

**Jupyter:**

- Outputs embedded in notebook JSON
- Can make files very large
- Binary data base64-encoded

**Deepnote:**

- Outputs stored in YAML format
- Cleaner representation
- Better for version control
- Optional output persistence

## Converting between formats

For detailed instructions on converting between Jupyter notebooks and Deepnote format, see the [Converting Notebooks guide](/docs/converting-notebooks).

## Example of a complete Deepnote file

Here's a minimal but complete example:

```yaml
metadata:
  createdAt: "2025-01-27T12:00:00Z"

version: "1.0.0"

project:
  id: "abc-123-def-456"
  name: "Sales Analysis"

  notebooks:
    - id: "notebook-001"
      name: "Q4 Analysis"
      executionMode: "block"
      isModule: false
      blocks:
        - id: "block-001"
          type: "markdown"
          sortingKey: "1"
          content: |
            # Q4 Sales Analysis

            This notebook analyzes sales data for Q4 2024.
          version: 1
          metadata: {}

        - id: "block-002"
          type: "code"
          sortingKey: "2"
          content: |
            import pandas as pd

            df = pd.read_csv('sales_q4.csv')
            print(f"Total rows: {len(df)}")
          executionCount: 1
          version: 1
          metadata: {}
          outputs:
            - output_type: "stream"
              name: "stdout"
              text: 'Total rows: 1523\n'

  integrations: []

  settings:
    environment:
      pythonVersion: "3.11"
    requirements:
      - "pandas>=2.0.0"
```

## Resources

- [Deepnote GitHub repository](https://github.com/deepnote/deepnote)
- [@deepnote/convert package](https://www.npmjs.com/package/@deepnote/convert)
- [Deepnote file schema](https://github.com/deepnote/deepnote/blob/main/packages/blocks/src/deserialize-file/deepnote-file-schema.ts)
