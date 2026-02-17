# Code and SQL Blocks

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

## Code Block (`code`)

Executable Python code cells.

**Metadata fields:**

| Field                  | Type      | Description                                |
| ---------------------- | --------- | ------------------------------------------ |
| `execution_start`      | `number`  | Execution start timestamp (ms)             |
| `execution_millis`     | `number`  | Execution duration (ms)                    |
| `source_hash`          | `string`  | Hash of source at execution time           |
| `deepnote_table_state` | `object`  | DataFrame display config                   |
| `is_code_hidden`       | `boolean` | Hide code in app mode                      |
| `is_output_hidden`     | `boolean` | Hide output in app mode                    |
| `function_export_name` | `string`  | Name when used as notebook function export |

**DataFrame config** (`deepnote_table_state`): Controls how DataFrames display in output. Contains column visibility, sort order, filters, and pagination settings.

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: code
  content: |
    import pandas as pd
    df = pd.read_csv("data.csv")
    df.head()
  sortingKey: a0
  metadata: {}
```

## SQL Block (`sql`)

SQL queries against database integrations.

**Metadata fields:**

| Field                           | Type                             | Description                                |
| ------------------------------- | -------------------------------- | ------------------------------------------ |
| `sql_integration_id`            | `string`                         | UUID of the integration to query           |
| `deepnote_variable_name`        | `string`                         | Variable name for query results            |
| `deepnote_return_variable_type` | `"dataframe" \| "query_preview"` | Return type                                |
| `is_compiled_sql_query_visible` | `boolean`                        | Show compiled query                        |
| `function_export_name`          | `string`                         | Name when used as notebook function export |

Plus all executable metadata fields (execution timing, table state, etc.).

```yaml
- id: c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
  blockGroup: d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
  type: sql
  content: |
    SELECT * FROM users
    WHERE created_at > '2024-01-01'
    LIMIT 100
  sortingKey: a1
  metadata:
    sql_integration_id: 084f5334-5dbe-41c7-9020-3f66b9418062
    deepnote_variable_name: df_users
    deepnote_return_variable_type: dataframe
```
