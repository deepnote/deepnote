---
title: Deepnote Blocks Package
description: Complete reference for the @deepnote/blocks package - TypeScript types, utilities, and Python code generation for Deepnote notebook blocks.
noIndex: false
noContent: false
---

# Deepnote Blocks Package

The `@deepnote/blocks` package is the core TypeScript library that defines Deepnote's block system. It provides type definitions, validation schemas, and utilities for working with all Deepnote block types, including Python code generation and markdown conversion.

## Overview

This package enables:

- **Type-safe block definitions** for all Deepnote block types
- **Python code generation** from blocks for local execution
- **Markdown conversion** for text-based blocks
- **Block validation** using Zod schemas
- **File serialization/deserialization** for `.deepnote` files

## Installation

```bash
npm install @deepnote/blocks
# or
pnpm add @deepnote/blocks
# or
yarn add @deepnote/blocks
```

## Core Concepts

### Block Structure

Every Deepnote block follows a common structure:

```typescript
interface DeepnoteBlock {
  id: string                    // Unique block identifier
  type: string                  // Block type (e.g., 'code', 'sql', 'markdown')
  sortingKey: string            // Base-36 encoded position for ordering
  blockGroup?: string           // Optional grouping identifier
  content?: string              // Block content (code, text, query, etc.)
  executionCount?: number       // Number of times executed
  version?: number              // Block schema version
  metadata?: Record<string, any> // Block-specific metadata
  outputs?: any[]               // Execution outputs (for executable blocks)
}
```

### Block Categories

Blocks are organized into several categories:

1. **Executable Blocks**: Code, SQL
2. **Input Blocks**: Text, Textarea, Checkbox, Select, Slider, File, Date, Date Range
3. **Display Blocks**: Visualization, Big Number, Button
4. **Text Blocks**: Headings, Paragraphs, Bullets, Todos, Callouts
5. **Media Blocks**: Image, Separator

## Python Code Generation

The primary use case for this package is generating executable Python code from Deepnote blocks for local execution.

### Basic Usage

```typescript
import { createPythonCode } from '@deepnote/blocks'

// Generate Python code from any executable block
const pythonCode = createPythonCode(block)
```

### Code Blocks

<!-- Code blocks are the simplest - they contain Python code directly:  -->

```typescript
import type { CodeBlock } from '@deepnote/blocks'

const codeBlock: CodeBlock = {
  id: 'block-001',
  type: 'code',
  sortingKey: '1',
  content: `
import pandas as pd
df = pd.read_csv('data.csv')
df.head()
  `,
  metadata: {},
}

const pythonCode = createPythonCode(codeBlock)
// Output:
// if '_dntk' in globals():
//   _dntk.dataframe_utils.configure_dataframe_formatter('{}')
// else:
//   _deepnote_current_table_attrs = '{}'
//
// import pandas as pd
// df = pd.read_csv('data.csv')
// df.head()
```

### Table State Configuration

Code blocks can include table state metadata for DataFrame display configuration:

```typescript
const codeBlockWithTableState: CodeBlock = {
  id: 'block-002',
  type: 'code',
  sortingKey: '2',
  content: 'df',
  metadata: {
    deepnote_table_state: {
      sortBy: [],
      filters: [],
      pageSize: 50,
      pageIndex: 0,
      columnOrder: ['id', 'name', 'value'],
      hiddenColumnIds: ['internal_id'],
      columnDisplayNames: [],
      conditionalFilters: [],
      cellFormattingRules: [],
      wrappedTextColumnIds: [],
    },
  },
}
```

### SQL Blocks

SQL blocks execute database queries and assign results to Python variables:

```typescript
import type { SqlBlock } from '@deepnote/blocks'

const sqlBlock: SqlBlock = {
  id: 'block-003',
  type: 'sql',
  sortingKey: '3',
  content: 'SELECT * FROM users WHERE active = true',
  metadata: {
    deepnote_variable_name: 'active_users',
    sql_integration_id: 'snowflake-connection-123',
    deepnote_return_variable_type: 'dataframe', // or 'query_preview'
  },
}

const pythonCode = createPythonCode(sqlBlock)
// Output:
// if '_dntk' in globals():
//   _dntk.dataframe_utils.configure_dataframe_formatter('{}')
// else:
//   _deepnote_current_table_attrs = '{}'
//
// active_users = _dntk.execute_sql(
//   'SELECT * FROM users WHERE active = true',
//   'SQL_SNOWFLAKE_CONNECTION_123',
//   audit_sql_comment='',
//   sql_cache_mode='cache_disabled',
//   return_variable_type='dataframe'
// )
// active_users
```

### Input Blocks

Input blocks generate Python variable assignments:

#### Text Input

```typescript
import type { InputTextBlock } from '@deepnote/blocks'

const textInput: InputTextBlock = {
  id: 'block-004',
  type: 'input-text',
  sortingKey: '4',
  content: '',
  metadata: {
    deepnote_variable_name: 'user_name',
    deepnote_variable_value: 'John Doe',
  },
}

const pythonCode = createPythonCode(textInput)
// Output: user_name = 'John Doe'
```

#### Checkbox Input

```typescript
import type { InputCheckboxBlock } from '@deepnote/blocks'

const checkboxInput: InputCheckboxBlock = {
  id: 'block-005',
  type: 'input-checkbox',
  sortingKey: '5',
  content: '',
  metadata: {
    deepnote_variable_name: 'is_enabled',
    deepnote_variable_value: true,
  },
}

const pythonCode = createPythonCode(checkboxInput)
// Output: is_enabled = True
```

#### Select Input

```typescript
import type { InputSelectBlock } from '@deepnote/blocks'

const selectInput: InputSelectBlock = {
  id: 'block-006',
  type: 'input-select',
  sortingKey: '6',
  content: '',
  metadata: {
    deepnote_variable_name: 'selected_region',
    deepnote_variable_value: 'US-West',
    deepnote_variable_options: ['US-East', 'US-West', 'EU', 'Asia'],
    deepnote_allow_multiple_values: false,
  },
}

const pythonCode = createPythonCode(selectInput)
// Output: selected_region = 'US-West'

// Multi-select example
const multiSelectInput: InputSelectBlock = {
  id: 'block-007',
  type: 'input-select',
  sortingKey: '7',
  content: '',
  metadata: {
    deepnote_variable_name: 'selected_regions',
    deepnote_variable_value: ['US-West', 'EU'],
    deepnote_allow_multiple_values: true,
  },
}

const pythonCode2 = createPythonCode(multiSelectInput)
// Output: selected_regions = ['US-West', 'EU']
```

#### Slider Input

```typescript
import type { InputSliderBlock } from '@deepnote/blocks'

const sliderInput: InputSliderBlock = {
  id: 'block-008',
  type: 'input-slider',
  sortingKey: '8',
  content: '',
  metadata: {
    deepnote_variable_name: 'threshold',
    deepnote_variable_value: '0.75',
    deepnote_slider_min_value: 0,
    deepnote_slider_max_value: 1,
    deepnote_slider_step: 0.05,
  },
}

const pythonCode = createPythonCode(sliderInput)
// Output: threshold = 0.75
```

#### Date Range Input

Date range inputs support multiple formats:

```typescript
import type { InputDateRangeBlock } from '@deepnote/blocks'

// Relative date range (past 7 days)
const relativeDateRange: InputDateRangeBlock = {
  id: 'block-009',
  type: 'input-date-range',
  sortingKey: '9',
  content: '',
  metadata: {
    deepnote_variable_name: 'date_range',
    deepnote_variable_value: 'past7days',
  },
}

const pythonCode = createPythonCode(relativeDateRange)
// Output:
// from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
// date_range = [
//   _deepnote_datetime.now().date() - _deepnote_timedelta(days=7),
//   _deepnote_datetime.now().date()
// ]

// Absolute date range
const absoluteDateRange: InputDateRangeBlock = {
  id: 'block-010',
  type: 'input-date-range',
  sortingKey: '10',
  content: '',
  metadata: {
    deepnote_variable_name: 'custom_range',
    deepnote_variable_value: ['2024-01-01', '2024-12-31'],
  },
}

// Custom days range
const customDaysRange: InputDateRangeBlock = {
  id: 'block-011',
  type: 'input-date-range',
  sortingKey: '11',
  content: '',
  metadata: {
    deepnote_variable_name: 'last_30_days',
    deepnote_variable_value: 'customDays30',
  },
}
```

**Supported relative ranges:**
- `'past7days'` - Last 7 days
- `'past14days'` - Last 14 days
- `'pastMonth'` - Last 30 days
- `'past3months'` - Last 90 days
- `'past6months'` - Last 180 days
- `'pastYear'` - Last 365 days
- `'customDaysN'` - Last N days (e.g., `'customDays45'`)

### Visualization Blocks

Visualization blocks use Vega-Lite specifications:

```typescript
import type { VisualizationBlock } from '@deepnote/blocks'

const chartBlock: VisualizationBlock = {
  id: 'block-012',
  type: 'visualization',
  sortingKey: '12',
  content: '',
  metadata: {
    deepnote_variable_name: 'sales_chart',
    deepnote_chart_spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { name: 'df' },
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
      },
    },
  },
}

const pythonCode = createPythonCode(chartBlock)
// Output:
// from deepnote_toolkit import chart
// sales_chart = chart(df, {...})
```

### Button Blocks

Button blocks can trigger variable updates:

```typescript
import type { ButtonBlock } from '@deepnote/blocks'

const buttonBlock: ButtonBlock = {
  id: 'block-013',
  type: 'button',
  sortingKey: '13',
  content: 'Refresh Data',
  metadata: {
    deepnote_button_variable_name: 'refresh_trigger',
    deepnote_button_variable_value: 'timestamp',
  },
}

// Requires execution context
const pythonCode = createPythonCode(buttonBlock, {
  timestamp: '2024-01-27T12:00:00Z',
})
// Output: refresh_trigger = '2024-01-27T12:00:00Z'
```

### Big Number Blocks

Big number blocks display KPIs with Jinja2 templates:

```typescript
import type { BigNumberBlock } from '@deepnote/blocks'

const bigNumberBlock: BigNumberBlock = {
  id: 'block-014',
  type: 'big-number',
  sortingKey: '14',
  content: '',
  metadata: {
    deepnote_variable_name: 'total_revenue',
    deepnote_big_number_template: '{{ value | currency }}',
    deepnote_big_number_value_source: 'df["revenue"].sum()',
  },
}

const pythonCode = createPythonCode(bigNumberBlock)
// Output:
// from deepnote_toolkit import big_number
// total_revenue = big_number(df["revenue"].sum(), template='{{ value | currency }}')
```

## Markdown Conversion

Text blocks can be converted to and from markdown:

```typescript
import { createMarkdown, stripMarkdown } from '@deepnote/blocks'

// Heading blocks
const h1Block = {
  type: 'text-cell-h1',
  content: 'Main Title',
  // ...
}
createMarkdown(h1Block) // "# Main Title"

// Bullet lists
const bulletBlock = {
  type: 'text-cell-bullet',
  content: 'List item',
  // ...
}
createMarkdown(bulletBlock) // "- List item"

// Todo items
const todoBlock = {
  type: 'text-cell-todo',
  content: 'Complete task',
  metadata: { checked: true },
  // ...
}
createMarkdown(todoBlock) // "- [x] Complete task"

// Callouts
const calloutBlock = {
  type: 'text-cell-callout',
  content: 'Important note',
  metadata: { color: 'blue' },
  // ...
}
createMarkdown(calloutBlock) // "> Important note"

// Strip markdown formatting
stripMarkdown(h1Block) // "Main Title"
```

## Block Type Guards

The package provides type guard functions for runtime type checking:

```typescript
import {
  isCodeBlock,
  isSqlBlock,
  isInputBlock,
  isInputTextBlock,
  isInputCheckboxBlock,
  isVisualizationBlock,
  isTextBlock,
} from '@deepnote/blocks'

function processBlock(block: DeepnoteBlock) {
  if (isCodeBlock(block)) {
    // TypeScript knows block is CodeBlock
    console.log('Code:', block.content)
  } else if (isSqlBlock(block)) {
    // TypeScript knows block is SqlBlock
    console.log('Query:', block.content)
    console.log('Variable:', block.metadata.deepnote_variable_name)
  } else if (isInputTextBlock(block)) {
    // TypeScript knows block is InputTextBlock
    console.log('Input value:', block.metadata.deepnote_variable_value)
  }
}
```

## File Schema Validation

The package includes Zod schemas for validating `.deepnote` files:

```typescript
import { deepnoteFileSchema, type DeepnoteFile } from '@deepnote/blocks'

// Validate a Deepnote file
const fileData = {
  metadata: {
    createdAt: '2025-01-27T12:00:00Z',
  },
  version: '1.0.0',
  project: {
    id: 'project-123',
    name: 'My Project',
    notebooks: [
      {
        id: 'notebook-001',
        name: 'Analysis',
        blocks: [],
        executionMode: 'block',
        isModule: false,
      },
    ],
    integrations: [],
    settings: {},
  },
}

const result = deepnoteFileSchema.safeParse(fileData)
if (result.success) {
  const validFile: DeepnoteFile = result.data
  console.log('Valid Deepnote file')
} else {
  console.error('Validation errors:', result.error)
}
```

## Error Handling

The package throws specific errors for unsupported operations:

```typescript
import { createPythonCode, UnsupportedBlockTypeError } from '@deepnote/blocks'

try {
  const pythonCode = createPythonCode(block)
} catch (error) {
  if (error instanceof UnsupportedBlockTypeError) {
    console.error('Block type not supported for Python generation:', error.message)
  }
}
```

## Advanced Usage

### Custom Block Processing

```typescript
import { createPythonCode, type DeepnoteBlock } from '@deepnote/blocks'

function processNotebook(blocks: DeepnoteBlock[]): string {
  const pythonCode = blocks
    .filter(block => {
      // Only process executable blocks
      return ['code', 'sql', 'input-text', 'input-checkbox'].includes(block.type)
    })
    .map(block => {
      try {
        return createPythonCode(block)
      } catch (error) {
        console.warn(`Skipping block ${block.id}: ${error.message}`)
        return null
      }
    })
    .filter(code => code !== null)
    .join('\n\n')

  return pythonCode
}
```

### Batch Conversion

```typescript
import { createPythonCode } from '@deepnote/blocks'
import type { DeepnoteFile } from '@deepnote/blocks'

function convertProjectToPython(deepnoteFile: DeepnoteFile): Map<string, string> {
  const notebookScripts = new Map<string, string>()

  for (const notebook of deepnoteFile.project.notebooks) {
    const pythonCode = notebook.blocks
      .map(block => {
        try {
          return createPythonCode(block)
        } catch {
          return null
        }
      })
      .filter(code => code !== null)
      .join('\n\n')

    notebookScripts.set(notebook.name, pythonCode)
  }

  return notebookScripts
}
```

## TypeScript Types Reference

### Core Types

```typescript
// Base block interface
interface DeepnoteBlock {
  id: string
  type: string
  sortingKey: string
  blockGroup?: string
  content?: string
  executionCount?: number
  version?: number
  metadata?: Record<string, any>
  outputs?: any[]
}

// Executable block metadata
interface ExecutableBlockMetadata {
  deepnote_cell_height?: number
  deepnote_to_be_reexecuted?: boolean
  // ... other execution-related metadata
}

// Table state for DataFrames
interface TableState {
  sortBy: any[]
  filters: any[]
  pageSize: number
  pageIndex: number
  columnOrder: string[]
  hiddenColumnIds: string[]
  columnDisplayNames: any[]
  conditionalFilters: any[]
  cellFormattingRules: any[]
  wrappedTextColumnIds: string[]
}
```

### Block-Specific Types

See the [Supported Code Blocks](./supported-code-blocks.md) documentation for detailed type definitions for each block type.

## Best Practices

1. **Type Safety**: Always use TypeScript types for block definitions
2. **Validation**: Validate blocks with Zod schemas before processing
3. **Error Handling**: Wrap `createPythonCode` calls in try-catch blocks
4. **Variable Naming**: Use `sanitizePythonVariableName` for user-provided variable names
5. **Metadata**: Store block-specific configuration in the `metadata` field
6. **Sorting**: Use base-36 encoded strings for `sortingKey` to maintain order

## Related Documentation

- [Supported Code Blocks](./supported-code-blocks.md) - Complete reference for all block types
- [Deepnote Format](./deepnote-format.md) - File format specification
- [Converting Notebooks](./converting-notebooks.md) - Jupyter ↔ Deepnote conversion

## Resources

- [GitHub Repository](https://github.com/deepnote/deepnote)
- [Package Source](https://github.com/deepnote/deepnote/tree/main/packages/blocks)
- [NPM Package](https://www.npmjs.com/package/@deepnote/blocks)


<!-- Note: Explain what big nubmer is, 

Expalin different types of blocks we have 
exaplain the date formats 
add link to our vega lite fork
add screenshots etc
block guards to best practices
 -->