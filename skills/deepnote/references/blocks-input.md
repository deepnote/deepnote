# Input Blocks

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

Interactive input widgets that set Python variables. All input blocks share these metadata fields:

| Field                    | Type     | Description                                          |
| ------------------------ | -------- | ---------------------------------------------------- |
| `deepnote_variable_name` | `string` | Python variable name (default: `"unnamed_variable"`) |
| `deepnote_input_label`   | `string` | Display label                                        |

## Text Input (`input-text`)

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

## Textarea Input (`input-textarea`)

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

## Checkbox Input (`input-checkbox`)

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

## Select Input (`input-select`)

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

## Slider Input (`input-slider`)

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

## Date Input (`input-date`)

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

## Date Range Input (`input-date-range`)

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

## File Input (`input-file`)

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
