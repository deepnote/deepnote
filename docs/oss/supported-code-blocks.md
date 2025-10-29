---
title: Supported Code Blocks in Deepnote
description: Complete reference for all code block types supported in Deepnote for local execution, including executable blocks, input blocks, and display blocks.
noIndex: false
noContent: false
---

# Supported Code Blocks in Deepnote

Deepnote supports a rich set of block types that go beyond traditional Jupyter notebooks. This document provides a complete reference for all block types that can be executed locally using the `@deepnote/blocks` package.

## Block Categories

Deepnote blocks are organized into several categories:

1. **[Executable Blocks](#executable-blocks)** - Code and SQL blocks that execute and produce outputs
2. **[Input Blocks](#input-blocks)** - Interactive parameter inputs that generate Python variables
3. **[Display Blocks](#display-blocks)** - Visualization, KPI, and interactive UI elements
4. **[Text Blocks](#text-blocks)** - Rich text content with formatting
5. **[Media Blocks](#media-blocks)** - Images and separators

## Executable Blocks

### Code Block (`code`)

Standard Python code execution block.

**Type:** `'code'`

**Structure:**
```typescript
interface CodeBlock {
  id: string
  type: 'code'
  content: string
  executionCount?: number
  metadata: {
    deepnote_table_state?: TableState
    deepnote_cell_height?: number
    deepnote_to_be_reexecuted?: boolean
  }
}
```

**Example:**
```yaml
- id: block-001
  type: code
  sortingKey: '1'
  content: |
    import pandas as pd
    import numpy as np
    
    df = pd.DataFrame({
        'name': ['Alice', 'Bob', 'Charlie'],
        'age': [25, 30, 35],
        'city': ['NYC', 'SF', 'LA']
    })
    df
  executionCount: 1
  metadata: {}
```

**Generated Python:**
```python
if '_dntk' in globals():
  _dntk.dataframe_utils.configure_dataframe_formatter('{}')
else:
  _deepnote_current_table_attrs = '{}'

import pandas as pd
import numpy as np

df = pd.DataFrame({
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35],
    'city': ['NYC', 'SF', 'LA']
})
df
```

**Table State Configuration:**

Code blocks can include DataFrame display configuration:

```yaml
metadata:
  deepnote_table_state:
    sortBy: []
    filters: []
    pageSize: 50
    pageIndex: 0
    columnOrder: ['name', 'age', 'city']
    hiddenColumnIds: []
    columnDisplayNames: []
    conditionalFilters: []
    cellFormattingRules: []
    wrappedTextColumnIds: []
```

### SQL Block (`sql`)

Execute SQL queries against connected databases.

**Type:** `'sql'`

**Structure:**
```typescript
interface SqlBlock {
  id: string
  type: 'sql'
  content: string
  executionCount?: number
  metadata: {
    deepnote_variable_name?: string
    sql_integration_id?: string
    deepnote_return_variable_type?: 'dataframe' | 'query_preview'
    deepnote_table_state?: TableState
    function_export_name?: string
    is_compiled_sql_query_visible?: boolean
  }
}
```

**Example:**
```yaml
- id: block-002
  type: sql
  sortingKey: '2'
  content: |
    SELECT 
        customer_id,
        SUM(amount) as total_spent,
        COUNT(*) as order_count
    FROM orders
    WHERE order_date >= '2024-01-01'
    GROUP BY customer_id
    ORDER BY total_spent DESC
    LIMIT 100
  metadata:
    deepnote_variable_name: top_customers
    sql_integration_id: snowflake-prod
    deepnote_return_variable_type: dataframe
```

**Generated Python:**
```python
if '_dntk' in globals():
  _dntk.dataframe_utils.configure_dataframe_formatter('{}')
else:
  _deepnote_current_table_attrs = '{}'

top_customers = _dntk.execute_sql(
  'SELECT \n    customer_id,\n    SUM(amount) as total_spent,\n    COUNT(*) as order_count\nFROM orders\nWHERE order_date >= \'2024-01-01\'\nGROUP BY customer_id\nORDER BY total_spent DESC\nLIMIT 100',
  'SQL_SNOWFLAKE_PROD',
  audit_sql_comment='',
  sql_cache_mode='cache_disabled',
  return_variable_type='dataframe'
)
top_customers
```

**Key Features:**
- Assigns query results to Python variables
- Supports multiple database integrations
- Can return as DataFrame or QueryPreview
- Includes table state for result display configuration

## Input Blocks

Input blocks create interactive parameters that generate Python variable assignments. They're ideal for parameterized notebooks and dashboards.

### Text Input (`input-text`)

Single-line text input.

**Type:** `'input-text'`

**Structure:**
```typescript
interface InputTextBlock {
  id: string
  type: 'input-text'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string
  }
}
```

**Example:**
```yaml
- id: block-003
  type: input-text
  sortingKey: '3'
  content: ''
  metadata:
    deepnote_variable_name: api_key
    deepnote_variable_value: sk-1234567890abcdef
```

**Generated Python:**
```python
api_key = 'sk-1234567890abcdef'
```

### Textarea Input (`input-textarea`)

Multi-line text input.

**Type:** `'input-textarea'`

**Structure:**
```typescript
interface InputTextareaBlock {
  id: string
  type: 'input-textarea'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string
  }
}
```

**Example:**
```yaml
- id: block-004
  type: input-textarea
  sortingKey: '4'
  content: ''
  metadata:
    deepnote_variable_name: sql_query
    deepnote_variable_value: |
      SELECT * FROM users
      WHERE created_at > '2024-01-01'
      LIMIT 1000
```

**Generated Python:**
```python
sql_query = 'SELECT * FROM users\nWHERE created_at > \'2024-01-01\'\nLIMIT 1000'
```

### Checkbox Input (`input-checkbox`)

Boolean checkbox input.

**Type:** `'input-checkbox'`

**Structure:**
```typescript
interface InputCheckboxBlock {
  id: string
  type: 'input-checkbox'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: boolean
  }
}
```

**Example:**
```yaml
- id: block-005
  type: input-checkbox
  sortingKey: '5'
  content: ''
  metadata:
    deepnote_variable_name: include_test_data
    deepnote_variable_value: false
```

**Generated Python:**
```python
include_test_data = False
```

### Select Input (`input-select`)

Dropdown selection (single or multiple).

**Type:** `'input-select'`

**Structure:**
```typescript
interface InputSelectBlock {
  id: string
  type: 'input-select'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string | string[]
    deepnote_variable_options?: string[]
    deepnote_variable_custom_options?: string[]
    deepnote_variable_selected_variable?: string
    deepnote_variable_select_type?: 'from_options' | 'from_variable'
    deepnote_allow_multiple_values?: boolean
  }
}
```

**Single Select Example:**
```yaml
- id: block-006
  type: input-select
  sortingKey: '6'
  content: ''
  metadata:
    deepnote_variable_name: environment
    deepnote_variable_value: production
    deepnote_variable_options:
      - development
      - staging
      - production
    deepnote_allow_multiple_values: false
```

**Generated Python:**
```python
environment = 'production'
```

**Multi-Select Example:**
```yaml
- id: block-007
  type: input-select
  sortingKey: '7'
  content: ''
  metadata:
    deepnote_variable_name: selected_regions
    deepnote_variable_value:
      - us-east-1
      - eu-west-1
    deepnote_variable_options:
      - us-east-1
      - us-west-2
      - eu-west-1
      - ap-southeast-1
    deepnote_allow_multiple_values: true
```

**Generated Python:**
```python
selected_regions = ['us-east-1', 'eu-west-1']
```

### Slider Input (`input-slider`)

Numeric slider input.

**Type:** `'input-slider'`

**Structure:**
```typescript
interface InputSliderBlock {
  id: string
  type: 'input-slider'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string  // Numeric string
    deepnote_slider_min_value?: number
    deepnote_slider_max_value?: number
    deepnote_slider_step?: number
  }
}
```

**Example:**
```yaml
- id: block-008
  type: input-slider
  sortingKey: '8'
  content: ''
  metadata:
    deepnote_variable_name: confidence_threshold
    deepnote_variable_value: '0.85'
    deepnote_slider_min_value: 0
    deepnote_slider_max_value: 1
    deepnote_slider_step: 0.05
```

**Generated Python:**
```python
confidence_threshold = 0.85
```

### File Input (`input-file`)

File path selector.

**Type:** `'input-file'`

**Structure:**
```typescript
interface InputFileBlock {
  id: string
  type: 'input-file'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string  // File path
  }
}
```

**Example:**
```yaml
- id: block-009
  type: input-file
  sortingKey: '9'
  content: ''
  metadata:
    deepnote_variable_name: data_file
    deepnote_variable_value: /work/data/sales_2024.csv
```

**Generated Python:**
```python
data_file = '/work/data/sales_2024.csv'
```

**Empty Value Example:**
```yaml
metadata:
  deepnote_variable_name: optional_file
  deepnote_variable_value: ''
```

**Generated Python:**
```python
optional_file = None
```

### Date Input (`input-date`)

Single date picker.

**Type:** `'input-date'`

**Structure:**
```typescript
interface InputDateBlock {
  id: string
  type: 'input-date'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: string  // ISO date string
    deepnote_input_date_version?: number
  }
}
```

**Example (Version 2):**
```yaml
- id: block-010
  type: input-date
  sortingKey: '10'
  content: ''
  metadata:
    deepnote_variable_name: report_date
    deepnote_variable_value: '2024-01-27'
    deepnote_input_date_version: 2
```

**Generated Python:**
```python
from dateutil.parser import parse as _deepnote_parse
report_date = _deepnote_parse('2024-01-27').date()
```

**Example (Version 1):**
```yaml
metadata:
  deepnote_variable_name: timestamp
  deepnote_variable_value: '2024-01-27T12:00:00.000Z'
```

**Generated Python:**
```python
from datetime import datetime as _deepnote_datetime
timestamp = _deepnote_datetime.strptime('2024-01-27T12:00:00.000Z', "%Y-%m-%dT%H:%M:%S.%fZ")
```

### Date Range Input (`input-date-range`)

Date range picker with relative and absolute ranges.

**Type:** `'input-date-range'`

**Structure:**
```typescript
interface InputDateRangeBlock {
  id: string
  type: 'input-date-range'
  content: string
  metadata: {
    deepnote_variable_name: string
    deepnote_variable_value: DateRangeInputValue
  }
}

type DateRangeInputValue = 
  | string  // ISO date
  | [string, string]  // Absolute range
  | 'past7days' | 'past14days' | 'pastMonth' | 'past3months' | 'past6months' | 'pastYear'
  | `customDays${number}`
```

**Relative Range Example:**
```yaml
- id: block-011
  type: input-date-range
  sortingKey: '11'
  content: ''
  metadata:
    deepnote_variable_name: analysis_period
    deepnote_variable_value: past7days
```

**Generated Python:**
```python
from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
analysis_period = [
  _deepnote_datetime.now().date() - _deepnote_timedelta(days=7),
  _deepnote_datetime.now().date()
]
```

**Absolute Range Example:**
```yaml
metadata:
  deepnote_variable_name: fiscal_year
  deepnote_variable_value:
    - '2024-01-01'
    - '2024-12-31'
```

**Generated Python:**
```python
from dateutil.parser import parse as _deepnote_parse
fiscal_year = [
  _deepnote_parse('2024-01-01').date() if '2024-01-01' else None,
  _deepnote_parse('2024-12-31').date() if '2024-12-31' else None
]
```

**Custom Days Example:**
```yaml
metadata:
  deepnote_variable_name: last_45_days
  deepnote_variable_value: customDays45
```

**Generated Python:**
```python
from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
last_45_days = [
  _deepnote_datetime.now().date() - _deepnote_timedelta(days=45),
  _deepnote_datetime.now().date()
]
```

**Supported Relative Ranges:**
- `'past7days'` - Last 7 days
- `'past14days'` - Last 14 days
- `'pastMonth'` - Last 30 days
- `'past3months'` - Last 90 days
- `'past6months'` - Last 180 days
- `'pastYear'` - Last 365 days
- `'customDaysN'` - Last N days (e.g., `'customDays45'`)

## Display Blocks

### Visualization Block (`visualization`)

Interactive charts using Vega-Lite specifications.

**Type:** `'visualization'`

**Structure:**
```typescript
interface VisualizationBlock {
  id: string
  type: 'visualization'
  content: string
  metadata: {
    deepnote_variable_name?: string
    deepnote_chart_spec?: VegaLiteSpec
  }
}
```

**Example:**
```yaml
- id: block-012
  type: visualization
  sortingKey: '12'
  content: ''
  metadata:
    deepnote_variable_name: sales_chart
    deepnote_chart_spec:
      $schema: https://vega.github.io/schema/vega-lite/v5.json
      data:
        name: sales_df
      mark: bar
      encoding:
        x:
          field: month
          type: ordinal
          title: Month
        y:
          field: revenue
          type: quantitative
          title: Revenue ($)
      width: 600
      height: 400
```

**Generated Python:**
```python
from deepnote_toolkit import chart
sales_chart = chart(sales_df, {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"name": "sales_df"},
  "mark": "bar",
  "encoding": {
    "x": {"field": "month", "type": "ordinal", "title": "Month"},
    "y": {"field": "revenue", "type": "quantitative", "title": "Revenue ($)"}
  },
  "width": 600,
  "height": 400
})
```

### Big Number Block (`big-number`)

Display KPIs with Jinja2 templates.

**Type:** `'big-number'`

**Structure:**
```typescript
interface BigNumberBlock {
  id: string
  type: 'big-number'
  content: string
  metadata: {
    deepnote_variable_name?: string
    deepnote_big_number_template?: string
    deepnote_big_number_value_source?: string
  }
}
```

**Example:**
```yaml
- id: block-013
  type: big-number
  sortingKey: '13'
  content: ''
  metadata:
    deepnote_variable_name: total_revenue
    deepnote_big_number_template: '{{ value | currency }}'
    deepnote_big_number_value_source: df["revenue"].sum()
```

**Generated Python:**
```python
from deepnote_toolkit import big_number
total_revenue = big_number(
  df["revenue"].sum(),
  template='{{ value | currency }}'
)
```

### Button Block (`button`)

Interactive button with variable control.

**Type:** `'button'`

**Structure:**
```typescript
interface ButtonBlock {
  id: string
  type: 'button'
  content: string  // Button label
  metadata: {
    deepnote_button_variable_name?: string
    deepnote_button_variable_value?: string
  }
}
```

**Example:**
```yaml
- id: block-014
  type: button
  sortingKey: '14'
  content: Refresh Data
  metadata:
    deepnote_button_variable_name: refresh_trigger
    deepnote_button_variable_value: timestamp
```

**Generated Python (requires execution context):**
```python
refresh_trigger = '2024-01-27T12:00:00Z'
```

## Text Blocks

Text blocks support rich formatting and are converted to markdown for local execution.

### Heading Blocks

**Types:** `'text-cell-h1'`, `'text-cell-h2'`, `'text-cell-h3'`

**Example:**
```yaml
- id: block-015
  type: text-cell-h1
  sortingKey: '15'
  content: Data Analysis Report
  metadata:
    formattedRanges: []

- id: block-016
  type: text-cell-h2
  sortingKey: '16'
  content: Executive Summary
  metadata: {}

- id: block-017
  type: text-cell-h3
  sortingKey: '17'
  content: Key Findings
  metadata: {}
```

**Markdown Output:**
```markdown
# Data Analysis Report

## Executive Summary

### Key Findings
```

### Paragraph Block (`text-cell-p`)

**Type:** `'text-cell-p'`

**Example:**
```yaml
- id: block-018
  type: text-cell-p
  sortingKey: '18'
  content: This analysis examines sales trends across Q4 2024.
  metadata: {}
```

**Markdown Output:**
```markdown
This analysis examines sales trends across Q4 2024.
```

### Bullet List Block (`text-cell-bullet`)

**Type:** `'text-cell-bullet'`

**Example:**
```yaml
- id: block-019
  type: text-cell-bullet
  sortingKey: '19'
  content: Revenue increased by 25%
  metadata: {}

- id: block-020
  type: text-cell-bullet
  sortingKey: '20'
  content: Customer acquisition cost decreased
  metadata: {}
```

**Markdown Output:**
```markdown
- Revenue increased by 25%
- Customer acquisition cost decreased
```

### Todo Block (`text-cell-todo`)

**Type:** `'text-cell-todo'`

**Example:**
```yaml
- id: block-021
  type: text-cell-todo
  sortingKey: '21'
  content: Review Q1 projections
  metadata:
    checked: false

- id: block-022
  type: text-cell-todo
  sortingKey: '22'
  content: Update dashboard
  metadata:
    checked: true
```

**Markdown Output:**
```markdown
- [ ] Review Q1 projections
- [x] Update dashboard
```

### Callout Block (`text-cell-callout`)

**Type:** `'text-cell-callout'`

**Example:**
```yaml
- id: block-023
  type: text-cell-callout
  sortingKey: '23'
  content: Important note about data quality
  metadata:
    color: blue
```

**Markdown Output:**
```markdown
> Important note about data quality
```

**Supported Colors:** `'blue'`, `'green'`, `'yellow'`, `'red'`, `'purple'`

### Text Formatting

Text blocks support rich formatting through `formattedRanges`:

```yaml
metadata:
  formattedRanges:
    - type: marks
      fromCodePoint: 0
      toCodePoint: 4
      marks:
        bold: true
    - type: marks
      fromCodePoint: 5
      toCodePoint: 11
      marks:
        italic: true
        color: '#FF0000'
    - type: link
      fromCodePoint: 12
      toCodePoint: 16
      url: https://example.com
      ranges:
        - type: marks
          fromCodePoint: 0
          toCodePoint: 4
          marks:
            underline: true
```

**Supported Marks:**
- `bold` - Bold text
- `italic` - Italic text
- `underline` - Underlined text
- `strike` - Strikethrough text
- `code` - Inline code
- `color` - Text color (CSS color value)

## Media Blocks

### Image Block (`image`)

**Type:** `'image'`

**Structure:**
```typescript
interface ImageBlock {
  id: string
  type: 'image'
  content: ''
  metadata: {
    deepnote_img_src?: string
    deepnote_img_width?: string
    deepnote_img_alignment?: 'left' | 'center' | 'right'
  }
}
```

**Example:**
```yaml
- id: block-024
  type: image
  sortingKey: '24'
  content: ''
  metadata:
    deepnote_img_src: https://example.com/chart.png
    deepnote_img_width: '600'
    deepnote_img_alignment: center
```

**Markdown Output:**
```markdown
<img src="https://example.com/chart.png" width="600" align="center" />
```

### Separator Block (`separator`)

**Type:** `'separator'`

**Example:**
```yaml
- id: block-025
  type: separator
  sortingKey: '25'
  content: ''
  metadata: {}
```

**Markdown Output:**
```markdown
<hr>
```

## Block Execution Order

Blocks are ordered using the `sortingKey` field, which uses base-36 encoding:

```yaml
blocks:
  - id: block-001
    sortingKey: '1'    # First block
  - id: block-002
    sortingKey: '2'    # Second block
  - id: block-003
    sortingKey: '1a'   # Inserted between 1 and 2
  - id: block-004
    sortingKey: '3'    # Third block
```

## Execution Modes

Deepnote notebooks support two execution modes:

### Block Mode (`executionMode: 'block'`)

Blocks execute independently. Each block can be run individually without affecting others.

```yaml
notebooks:
  - id: notebook-001
    name: Analysis
    executionMode: block
    blocks: [...]
```

### Downstream Mode (`executionMode: 'downstream'`)

When a block is executed, all dependent blocks automatically re-execute.

```yaml
notebooks:
  - id: notebook-002
    name: Pipeline
    executionMode: downstream
    blocks: [...]
```

## Module Notebooks

Notebooks can be marked as modules for reuse across projects:

```yaml
notebooks:
  - id: notebook-003
    name: Data Utils
    isModule: true
    executionMode: block
    blocks: [...]
```

Module notebooks can be imported in other notebooks:

```python
from data_utils import clean_dataframe, validate_schema
```

## Working Directory

Each notebook can specify a working directory:

```yaml
notebooks:
  - id: notebook-004
    name: Analysis
    workingDirectory: /work/analysis
    blocks: [...]
```

Default working directory is `/work`.

## Best Practices

### Variable Naming

Always use valid Python identifiers for variable names:

```yaml
# Good
metadata:
  deepnote_variable_name: user_count

# Bad (will be sanitized)
metadata:
  deepnote_variable_name: user-count  # Becomes user_count
```

### Input Block Organization

Group related input blocks at the top of notebooks:

```yaml
blocks:
  # Input parameters
  - type: input-date-range
    # ...
  - type: input-select
    # ...
  - type: input-checkbox
    # ...
  
  # Data loading
  - type: code
    # ...
  
  # Analysis
  - type: sql
    # ...
```

### SQL Block Variables

Always assign SQL results to variables for reuse:

```yaml
- type: sql
  content: SELECT * FROM users
  metadata:
    deepnote_variable_name: users_df  # Required for reuse
```

### Error Handling

Wrap block execution in try-catch when processing programmatically:

```typescript
import { createPythonCode, UnsupportedBlockTypeError } from '@deepnote/blocks'

try {
  const pythonCode = createPythonCode(block)
} catch (error) {
  if (error instanceof UnsupportedBlockTypeError) {
    console.warn(`Skipping unsupported block type: ${block.type}`)
  }
}
```

## Unsupported Block Types

The following block types are not yet supported for local Python code generation:

- Custom app blocks
- Third-party integrations
- Proprietary visualization types

These blocks will throw an `UnsupportedBlockTypeError` when passed to `createPythonCode()`.

## Related Documentation

- [Blocks Package](./blocks-package.md) - Package API reference
- [Deepnote Format](./deepnote-format.md) - File format specification
- [Converting Notebooks](./converting-notebooks.md) - Jupyter ↔ Deepnote conversion
- [Local Setup](./local-setup.md) - Running Deepnote notebooks locally

## Resources

- [GitHub Repository](https://github.com/deepnote/deepnote)
- [Block Types Source](https://github.com/deepnote/deepnote/tree/main/packages/blocks/src/blocks)
- [Example Notebooks](https://github.com/deepnote/deepnote/tree/main/examples)
