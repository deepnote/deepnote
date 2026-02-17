# Display and Action Blocks

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

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
