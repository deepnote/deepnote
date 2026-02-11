# Block Types Reference

All blocks share common fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`). This reference covers type-specific metadata fields and YAML examples.

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

## Markdown Block (`markdown`)

Rich text documentation using Markdown syntax.

**Metadata fields:**

| Field                  | Type     | Description         |
| ---------------------- | -------- | ------------------- |
| `deepnote_cell_height` | `number` | Cell display height |

```yaml
- id: e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  blockGroup: f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
  type: markdown
  content: |
    ## Data Analysis

    This notebook explores the **customer dataset** and generates insights.
  sortingKey: a2
  metadata: {}
```

## Text Cell Blocks

Structured text blocks for headings, paragraphs, lists, and callouts.

### Common Text Cell Metadata

| Field             | Type      | Description                   |
| ----------------- | --------- | ----------------------------- |
| `is_collapsed`    | `boolean` | Whether the cell is collapsed |
| `formattedRanges` | `array`   | Inline formatting ranges      |

### Heading Blocks (`text-cell-h1`, `text-cell-h2`, `text-cell-h3`)

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: text-cell-h1
  content: Main Title
  sortingKey: a0
  metadata: {}
```

### Paragraph Block (`text-cell-p`)

```yaml
- id: c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
  blockGroup: d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
  type: text-cell-p
  content: This is a paragraph of explanatory text.
  sortingKey: a1
  metadata: {}
```

### Bullet Block (`text-cell-bullet`)

```yaml
- id: e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  blockGroup: f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
  type: text-cell-bullet
  content: First bullet point
  sortingKey: a2
  metadata: {}
```

### Todo Block (`text-cell-todo`)

**Additional metadata:**

| Field     | Type      | Description                        |
| --------- | --------- | ---------------------------------- |
| `checked` | `boolean` | Whether the todo item is completed |

```yaml
- id: a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5
  blockGroup: b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5
  type: text-cell-todo
  content: Clean up the dataset
  sortingKey: a3
  metadata:
    checked: false
```

### Callout Block (`text-cell-callout`)

**Additional metadata:**

| Field   | Type                                                 | Description   |
| ------- | ---------------------------------------------------- | ------------- |
| `color` | `"blue" \| "green" \| "yellow" \| "red" \| "purple"` | Callout color |

```yaml
- id: c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7
  blockGroup: d5e6f7a8b9c0d5e6f7a8b9c0d5e6f7a8
  type: text-cell-callout
  content: Important note about data quality.
  sortingKey: a4
  metadata:
    color: yellow
```

## Input Blocks

Interactive input widgets that set Python variables. All input blocks share these metadata fields:

| Field                    | Type     | Description                                          |
| ------------------------ | -------- | ---------------------------------------------------- |
| `deepnote_variable_name` | `string` | Python variable name (default: `"unnamed_variable"`) |
| `deepnote_input_label`   | `string` | Display label                                        |

### Text Input (`input-text`)

| Field                             | Type     | Description   |
| --------------------------------- | -------- | ------------- |
| `deepnote_variable_value`         | `string` | Current value |
| `deepnote_variable_default_value` | `string` | Default value |

```yaml
- id: f7a8b9c0d1e2f7a8b9c0d1e2f7a8b9c0
  blockGroup: a8b9c0d1e2f3a8b9c0d1e2f3a8b9c0d1
  type: input-text
  sortingKey: a0
  metadata:
    deepnote_variable_name: user_name
    deepnote_variable_value: ""
    deepnote_variable_default_value: "Alice"
```

### Textarea Input (`input-textarea`)

Same metadata as `input-text` but renders as a multi-line text area.

```yaml
- id: b9c0d1e2f3a4b9c0d1e2f3a4b9c0d1e2
  blockGroup: c0d1e2f3a4b5c0d1e2f3a4b5c0d1e2f3
  type: input-textarea
  sortingKey: a1
  metadata:
    deepnote_variable_name: description
    deepnote_variable_value: ""
```

### Checkbox Input (`input-checkbox`)

| Field                             | Type      | Description                      |
| --------------------------------- | --------- | -------------------------------- |
| `deepnote_variable_value`         | `boolean` | Current value (default: `false`) |
| `deepnote_variable_default_value` | `boolean` | Default value                    |
| `deepnote_input_checkbox_label`   | `string`  | Checkbox label text              |

```yaml
- id: d1e2f3a4b5c6d1e2f3a4b5c6d1e2f3a4
  blockGroup: e2f3a4b5c6d7e2f3a4b5c6d7e2f3a4b5
  type: input-checkbox
  sortingKey: a2
  metadata:
    deepnote_variable_name: include_outliers
    deepnote_variable_value: false
    deepnote_input_checkbox_label: Include outliers in analysis
```

### Select Input (`input-select`)

| Field                                 | Type                                | Description                     |
| ------------------------------------- | ----------------------------------- | ------------------------------- |
| `deepnote_variable_value`             | `string \| string[]`                | Selected value(s)               |
| `deepnote_variable_default_value`     | `string \| string[]`                | Default value(s)                |
| `deepnote_variable_options`           | `string[]`                          | Available options               |
| `deepnote_variable_custom_options`    | `string[]`                          | User-added custom options       |
| `deepnote_variable_selected_variable` | `string`                            | Variable to source options from |
| `deepnote_variable_select_type`       | `"from-options" \| "from-variable"` | Option source                   |
| `deepnote_allow_multiple_values`      | `boolean`                           | Allow multi-select              |
| `deepnote_allow_empty_values`         | `boolean`                           | Allow empty selection           |

```yaml
- id: f3a4b5c6d7e8f3a4b5c6d7e8f3a4b5c6
  blockGroup: a4b5c6d7e8f9a4b5c6d7e8f9a4b5c6d7
  type: input-select
  sortingKey: a3
  metadata:
    deepnote_variable_name: region
    deepnote_variable_value: us-east
    deepnote_variable_options:
      - us-east
      - us-west
      - eu-west
    deepnote_variable_select_type: from-options
```

### Slider Input (`input-slider`)

| Field                             | Type     | Description                              |
| --------------------------------- | -------- | ---------------------------------------- |
| `deepnote_variable_value`         | `string` | Current value as string (default: `"0"`) |
| `deepnote_variable_default_value` | `string` | Default value as string                  |
| `deepnote_slider_min_value`       | `number` | Minimum value (default: `0`)             |
| `deepnote_slider_max_value`       | `number` | Maximum value (default: `100`)           |
| `deepnote_slider_step`            | `number` | Step increment (default: `1`)            |

```yaml
- id: b5c6d7e8f9a0b5c6d7e8f9a0b5c6d7e8
  blockGroup: c6d7e8f9a0b1c6d7e8f9a0b1c6d7e8f9
  type: input-slider
  sortingKey: a4
  metadata:
    deepnote_variable_name: threshold
    deepnote_variable_value: "50"
    deepnote_slider_min_value: 0
    deepnote_slider_max_value: 100
    deepnote_slider_step: 5
```

### Date Input (`input-date`)

| Field                             | Type      | Description             |
| --------------------------------- | --------- | ----------------------- |
| `deepnote_variable_value`         | `string`  | Selected date as string |
| `deepnote_variable_default_value` | `string`  | Default date            |
| `deepnote_allow_empty_values`     | `boolean` | Allow empty date        |
| `deepnote_input_date_version`     | `number`  | Date picker version     |

```yaml
- id: d7e8f9a0b1c2d7e8f9a0b1c2d7e8f9a0
  blockGroup: e8f9a0b1c2d3e8f9a0b1c2d3e8f9a0b1
  type: input-date
  sortingKey: a5
  metadata:
    deepnote_variable_name: start_date
    deepnote_variable_value: "2025-01-01"
```

### Date Range Input (`input-date-range`)

| Field                             | Type                         | Description                |
| --------------------------------- | ---------------------------- | -------------------------- |
| `deepnote_variable_value`         | `[string, string] \| string` | Date range tuple or string |
| `deepnote_variable_default_value` | `[string, string] \| string` | Default range              |

```yaml
- id: f9a0b1c2d3e4f9a0b1c2d3e4f9a0b1c2
  blockGroup: a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3
  type: input-date-range
  sortingKey: a6
  metadata:
    deepnote_variable_name: date_range
    deepnote_variable_value:
      - "2025-01-01"
      - "2025-12-31"
```

### File Input (`input-file`)

| Field                              | Type     | Description                              |
| ---------------------------------- | -------- | ---------------------------------------- |
| `deepnote_variable_value`          | `string` | File path                                |
| `deepnote_allowed_file_extensions` | `string` | Allowed extensions (e.g. `".csv,.xlsx"`) |

```yaml
- id: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  blockGroup: c2d3e4f5a6b7c2d3e4f5a6b7c2d3e4f5
  type: input-file
  sortingKey: a7
  metadata:
    deepnote_variable_name: data_file
    deepnote_variable_value: ""
    deepnote_allowed_file_extensions: ".csv,.xlsx,.parquet"
```

## Visualization Block (`visualization`)

Charts and graphs (Vega-Lite based).

| Field                         | Type      | Description                   |
| ----------------------------- | --------- | ----------------------------- |
| `deepnote_variable_name`      | `string`  | Source DataFrame variable     |
| `deepnote_visualization_spec` | `object`  | Vega-Lite chart specification |
| `deepnote_config_collapsed`   | `boolean` | Collapse config panel         |
| `deepnote_chart_height`       | `number`  | Chart height in pixels        |
| `deepnote_chart_filter`       | `object`  | Chart filter config           |

```yaml
- id: d3e4f5a6b7c8d3e4f5a6b7c8d3e4f5a6
  blockGroup: e4f5a6b7c8d9e4f5a6b7c8d9e4f5a6b7
  type: visualization
  sortingKey: a5
  metadata:
    deepnote_variable_name: df
    deepnote_visualization_spec:
      mark: bar
      encoding:
        x:
          field: category
        y:
          field: count
```

## Button Block (`button`)

| Field                          | Type                                                  | Description                                       |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| `deepnote_button_title`        | `string`                                              | Button label                                      |
| `deepnote_button_color_scheme` | `"blue" \| "red" \| "neutral" \| "green" \| "yellow"` | Color                                             |
| `deepnote_button_behavior`     | `"run" \| "set_variable"`                             | Click behavior                                    |
| `deepnote_variable_name`       | `string`                                              | Variable to set (when behavior is `set_variable`) |

```yaml
- id: f5a6b7c8d9e0f5a6b7c8d9e0f5a6b7c8
  blockGroup: a6b7c8d9e0f1a6b7c8d9e0f1a6b7c8d9
  type: button
  sortingKey: a6
  metadata:
    deepnote_button_title: Run Analysis
    deepnote_button_color_scheme: blue
    deepnote_button_behavior: run
```

## Big Number Block (`big-number`)

| Field                                    | Type      | Description           |
| ---------------------------------------- | --------- | --------------------- |
| `deepnote_big_number_title`              | `string`  | Display title         |
| `deepnote_big_number_value`              | `string`  | Main value expression |
| `deepnote_big_number_format`             | `string`  | Number format string  |
| `deepnote_big_number_comparison_enabled` | `boolean` | Show comparison       |
| `deepnote_big_number_comparison_title`   | `string`  | Comparison label      |
| `deepnote_big_number_comparison_value`   | `string`  | Comparison value      |
| `deepnote_big_number_comparison_type`    | `string`  | Comparison type       |
| `deepnote_big_number_comparison_format`  | `string`  | Comparison format     |

```yaml
- id: b7c8d9e0f1a2b7c8d9e0f1a2b7c8d9e0
  blockGroup: c8d9e0f1a2b3c8d9e0f1a2b3c8d9e0f1
  type: big-number
  sortingKey: a7
  metadata:
    deepnote_big_number_title: Total Revenue
    deepnote_big_number_value: revenue_total
    deepnote_big_number_format: "$,.0f"
```

## Notebook Function Block (`notebook-function`)

Calls another notebook as a function.

| Field                               | Type             | Description                |
| ----------------------------------- | ---------------- | -------------------------- |
| `function_notebook_id`              | `string \| null` | ID of the notebook to call |
| `function_notebook_inputs`          | `object`         | Input parameter mappings   |
| `function_notebook_export_mappings` | `object`         | Output variable mappings   |

```yaml
- id: d9e0f1a2b3c4d9e0f1a2b3c4d9e0f1a2
  blockGroup: e0f1a2b3c4d5e0f1a2b3c4d5e0f1a2b3
  type: notebook-function
  sortingKey: a8
  metadata:
    function_notebook_id: e132b172-b114-410e-8331-011517db664f
    function_notebook_inputs:
      input_df: my_dataframe
```

## Image Block (`image`)

| Field                    | Type                                   | Description           |
| ------------------------ | -------------------------------------- | --------------------- |
| `deepnote_img_src`       | `string`                               | Image URL or data URI |
| `deepnote_img_width`     | `"actual" \| "50%" \| "75%" \| "100%"` | Display width         |
| `deepnote_img_alignment` | `"left" \| "center" \| "right"`        | Alignment             |

```yaml
- id: f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4
  blockGroup: a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5
  type: image
  sortingKey: a9
  metadata:
    deepnote_img_src: "https://example.com/chart.png"
    deepnote_img_width: "100%"
    deepnote_img_alignment: center
```

## Separator Block (`separator`)

A horizontal divider. No type-specific metadata.

```yaml
- id: b3c4d5e6f7a8b3c4d5e6f7a8b3c4d5e6
  blockGroup: c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7
  type: separator
  sortingKey: b0
  metadata: {}
```

## App Mode Metadata

All blocks support these app-mode display fields:

| Field                            | Type             | Description               |
| -------------------------------- | ---------------- | ------------------------- |
| `deepnote_app_is_code_hidden`    | `boolean`        | Hide code in app          |
| `deepnote_app_is_output_hidden`  | `boolean`        | Hide output in app        |
| `deepnote_app_block_visible`     | `boolean`        | Block visibility in app   |
| `deepnote_app_block_width`       | `number`         | Block width in app layout |
| `deepnote_app_block_group_id`    | `string \| null` | App layout group          |
| `deepnote_app_block_subgroup_id` | `string`         | App layout subgroup       |
| `deepnote_app_block_order`       | `number`         | Order within app group    |
