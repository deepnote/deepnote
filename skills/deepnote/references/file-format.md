# Deepnote File Format Reference

## File Types

| File                  | Extension            | Purpose                                                  |
| --------------------- | -------------------- | -------------------------------------------------------- |
| **Deepnote Project**  | `.deepnote`          | Source file containing code, markdown, and configuration |
| **Deepnote Snapshot** | `.snapshot.deepnote` | A `.deepnote` file with execution outputs populated      |

Both use the same YAML-based format.

## Top-Level Fields

| Field          | Required | Type     | Description                                |
| -------------- | -------- | -------- | ------------------------------------------ |
| `version`      | Yes      | `string` | Schema version (currently `"1.0.0"`)       |
| `metadata`     | Yes      | `object` | File timestamps and metadata               |
| `project`      | Yes      | `object` | Project definition with notebooks          |
| `integrations` | No       | `array`  | Database connections and external services |
| `environment`  | No       | `object` | Python version and package dependencies    |
| `execution`    | No       | `object` | Execution summary (present in snapshots)   |

## Metadata

```yaml
metadata:
  createdAt: "2025-01-08T10:00:00.000Z" # Required: ISO 8601 timestamp
  modifiedAt: "2025-01-08T12:30:00.000Z" # Optional
  exportedAt: "2025-01-08T12:30:00.000Z" # Optional
  checksum: "sha256:abc123..." # Optional
  snapshotHash: "sha256:def456..." # Required in snapshots only
```

## Project

```yaml
project:
  id: 2e814690-4f02-465c-8848-5567ab9253b7 # Required: UUID v4
  name: My Analysis Project # Required: human-readable
  initNotebookId: e132b172-... # Optional: initial notebook
  notebooks: [...] # Required: array of notebooks
  integrations: [...] # Optional: project-level integrations
  settings: # Optional
    sqlCacheMaxAge: 300 # SQL cache TTL in seconds
```

## Notebook Fields

| Field              | Required | Type                      | Description                                |
| ------------------ | -------- | ------------------------- | ------------------------------------------ |
| `id`               | Yes      | `string`                  | UUID v4 identifier                         |
| `name`             | Yes      | `string`                  | Human-readable name                        |
| `blocks`           | Yes      | `array`                   | Array of block objects                     |
| `executionMode`    | No       | `"block" \| "downstream"` | How blocks execute                         |
| `workingDirectory` | No       | `string`                  | Base directory for file operations         |
| `isModule`         | No       | `boolean`                 | Whether this notebook is a reusable module |

## Block Common Fields

| Field         | Required | Type     | Description                                     |
| ------------- | -------- | -------- | ----------------------------------------------- |
| `id`          | Yes      | `string` | Unique identifier (32-char hex)                 |
| `blockGroup`  | Yes      | `string` | Group identifier (32-char hex)                  |
| `type`        | Yes      | `string` | Block type discriminator                        |
| `content`     | Varies   | `string` | Source code, text, or query                     |
| `sortingKey`  | Yes      | `string` | Display order (lexicographic)                   |
| `metadata`    | Yes      | `object` | Type-specific configuration                     |
| `contentHash` | No       | `string` | SHA-256 hash of content (pattern: `sha256:hex`) |
| `version`     | No       | `number` | Block version                                   |

### Executable Block Additional Fields

Executable blocks (`code`, `sql`, `visualization`, `button`, `big-number`, `notebook-function`, all `input-*`) also have:

| Field                 | Type             | Description                        |
| --------------------- | ---------------- | ---------------------------------- |
| `executionCount`      | `number \| null` | Number of times executed           |
| `executionFinishedAt` | `string`         | ISO 8601 datetime                  |
| `executionStartedAt`  | `string`         | ISO 8601 datetime                  |
| `outputs`             | `array`          | Execution outputs (Jupyter format) |

## Output Format

Outputs follow the Jupyter output format:

### Stream Output (stdout/stderr)

```yaml
outputs:
  - name: stdout
    output_type: stream
    text: |
      Hello World!
```

### Rich Display Output

```yaml
outputs:
  - data:
      text/plain: "<DataFrame with 100 rows>"
      text/html: "<table>...</table>"
      application/vnd.deepnote.dataframe.v3+json:
        columns: [...]
        rows: [...]
    output_type: execute_result
    execution_count: 1
```

### Error Output

```yaml
outputs:
  - ename: ValueError
    evalue: "invalid input"
    output_type: error
    traceback:
      - "Traceback (most recent call last):"
      - "..."
```

## Environment

```yaml
environment:
  python:
    version: "3.11"
    environment: uv # uv | conda | venv | poetry | system
  packages:
    pandas: "2.1.0"
    numpy: "1.26.0"
  hash: "sha256:abc123..." # Environment content hash
  platform: "linux-x86_64" # Optional
  customImage: "my-image" # Optional: custom Docker image
```

## Integrations

```yaml
integrations:
  - id: 084f5334-5dbe-41c7-9020-3f66b9418062
    name: Production Database
    type: pgsql
```

Each integration has: `id` (UUID string), `name` (string), `type` (string — one of the supported database types).

## Snapshot Structure

Snapshots extend the base format with required fields:

- `environment` is **required** (optional in source files)
- `execution` is **required** with summary info
- `metadata.snapshotHash` is **required**
- Blocks include `contentHash` and populated `outputs`

### Snapshot Naming Convention

```text
{project-name}_{project-id}_{timestamp}.snapshot.deepnote
```

- `project-name`: Slugified project name (e.g. `customer-analysis`)
- `project-id`: Full UUID v4
- `timestamp`: `latest` or ISO 8601 format (e.g. `2025-01-08T10-30-00`)

### Snapshot Hash

The `snapshotHash` in metadata is computed from:

- All block `contentHash` values
- `environment.hash`
- `version`
- `project.integrations` (id, type, name)

It answers: "Has the code, environment, or integrations changed since this snapshot was taken?"

### Latest vs Timestamped

| Aspect      | `latest`                             | Timestamped                 |
| ----------- | ------------------------------------ | --------------------------- |
| Creation    | Updated incrementally per block      | Created from full execution |
| Consistency | May mix outputs from different times | All outputs from same run   |
| Overwriting | Always overwritten                   | Immutable                   |

## Execution

Present in snapshot files:

```yaml
execution:
  startedAt: "2025-01-08T10:30:00.000Z"
  finishedAt: "2025-01-08T10:30:05.000Z"
  triggeredBy: user # user | schedule | api | ci
  inputs:
    my_var: "some value"
  summary:
    blocksExecuted: 5
    blocksSucceeded: 4
    blocksFailed: 1
    totalDurationMs: 5000
  error:
    name: ValueError
    message: "invalid input"
    traceback: ["..."]
```
