---
title: Deepnote open-source code blocks package
description: Complete reference for the @deepnote/blocks package - TypeScript types, utilities, and Python code generation for Deepnote notebook blocks.
noIndex: false
noContent: false
---

# Deepnote open-source code blocks package

The [`@deepnote/blocks`](https://github.com/deepnote/deepnote/tree/main/packages/blocks) package is the core TypeScript library that defines Deepnote's block system. It provides type definitions, validation schemas, and utilities for working with all Deepnote block types, including Python code generation and markdown conversion.

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

## Core concepts

### Block structure

Every Deepnote block follows a common structure:

```typescript
interface DeepnoteBlock {
  id: string; // Unique block identifier
  type: string; // Block type (e.g., 'code', 'sql', 'markdown')
  sortingKey: string; // Base-36 encoded position for ordering
  blockGroup?: string; // Optional grouping identifier
  content?: string; // Block content (code, text, query, etc.)
  executionCount?: number; // Number of times executed
  version?: number; // Block schema version
  metadata?: Record<string, any>; // Block-specific metadata
  outputs?: any[]; // Execution outputs (for executable blocks)
}
```

### Block categories

Deepnote supports a wide variety of block types organized into several categories:

#### 1. Executable blocks

- **Code Block** (`code`): Python code cells with execution support
- **SQL Block** (`sql`): Database query blocks that execute SQL and assign results to variables

#### 2. Input blocks

Interactive input controls that create Python variables:

- **Text input** (`input-text`): Single-line text input
- **Textarea input** (`input-textarea`): Multi-line text input
- **Checkbox** (`input-checkbox`): Boolean checkbox input
- **Select** (`input-select`): Dropdown selector (single or multi-select)
- **Slider** (`input-slider`): Numeric slider with min/max/step configuration
- **File upload** (`input-file`): File upload control
- **Date input** (`input-date`): Single date picker
- **Date range** (`input-date-range`): Date range selector with relative and absolute options

#### 3. Display blocks

Blocks for visualizing data and metrics:

- **Visualization** (`visualization`): Charts and graphs using Vega-Lite specifications
- **Big number** (`big-number`): KPI displays with formatting templates
- **Button** (`button`): Interactive buttons that trigger variable updates

#### 4. Text blocks

Markdown-compatible text content blocks:

- **Heading 1** (`text-cell-h1`): Top-level headings
- **Heading 2** (`text-cell-h2`): Second-level headings
- **Heading 3** (`text-cell-h3`): Third-level headings
- **Paragraph** (`text-cell-p`): Regular text paragraphs
- **Bullet list** (`text-cell-bullet`): Unordered list items
- **Todo** (`text-cell-todo`): Checkable todo items
- **Callout** (`text-cell-callout`): Highlighted information boxes

#### 5. Media blocks

- **Image** (`image`): Embedded images
- **Separator** (`separator`): Visual dividers

## Python code generation

The primary use case for this package is generating executable Python code from Deepnote blocks for local execution.

### Basic usage

```typescript
import { createPythonCode } from "@deepnote/blocks";

// Generate Python code from any executable block
const pythonCode = createPythonCode(block);
```

### Code blocks

```typescript
import type { CodeBlock } from "@deepnote/blocks";

const codeBlock: CodeBlock = {
  id: "block-001",
  type: "code",
  sortingKey: "1",
  content: `
import pandas as pd
df = pd.read_csv('data.csv')
df.head()
  `,
  metadata: {},
};

const pythonCode = createPythonCode(codeBlock);
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

### Table state configuration

Code blocks can include table state metadata for DataFrame display configuration:

```typescript
const codeBlockWithTableState: CodeBlock = {
  id: "block-002",
  type: "code",
  sortingKey: "2",
  content: "df",
  metadata: {
    deepnote_table_state: {
      sortBy: [],
      filters: [],
      pageSize: 50,
      pageIndex: 0,
      columnOrder: ["id", "name", "value"],
      hiddenColumnIds: ["internal_id"],
      columnDisplayNames: [],
      conditionalFilters: [],
      cellFormattingRules: [],
      wrappedTextColumnIds: [],
    },
  },
};
```

### SQL blocks

SQL blocks execute database queries and assign results to Python variables, learn more about `SQL blocks` in the [Deepnote documentation](https://deepnote.com/docs/sql-blocks):

```typescript
import type { SqlBlock } from "@deepnote/blocks";

const sqlBlock: SqlBlock = {
  id: "block-003",
  type: "sql",
  sortingKey: "3",
  content: "SELECT * FROM users WHERE active = true",
  metadata: {
    deepnote_variable_name: "active_users",
    sql_integration_id: "snowflake-connection-123",
    deepnote_return_variable_type: "dataframe", // or 'query_preview'
  },
};

const pythonCode = createPythonCode(sqlBlock);
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

### Input blocks

Input blocks generate Python variable assignments:

#### Text input

```typescript
import type { InputTextBlock } from "@deepnote/blocks";

const textInput: InputTextBlock = {
  id: "block-004",
  type: "input-text",
  sortingKey: "4",
  content: "",
  metadata: {
    deepnote_variable_name: "user_name",
    deepnote_variable_value: "John Doe",
  },
};

const pythonCode = createPythonCode(textInput);
// Output: user_name = 'John Doe'
```

#### Checkbox input

Checkbox input generates a boolean Python variable assignment:

```typescript
import type { InputCheckboxBlock } from "@deepnote/blocks";

const checkboxInput: InputCheckboxBlock = {
  id: "block-005",
  type: "input-checkbox",
  sortingKey: "5",
  content: "",
  metadata: {
    deepnote_variable_name: "is_enabled",
    deepnote_variable_value: true,
  },
};

const pythonCode = createPythonCode(checkboxInput);
// Output: is_enabled = True
```

#### Select input

Select input generates a string Python variable assignment:

```typescript
import type { InputSelectBlock } from "@deepnote/blocks";

const selectInput: InputSelectBlock = {
  id: "block-006",
  type: "input-select",
  sortingKey: "6",
  content: "",
  metadata: {
    deepnote_variable_name: "selected_region",
    deepnote_variable_value: "US-West",
    deepnote_variable_options: ["US-East", "US-West", "EU", "Asia"],
    deepnote_allow_multiple_values: false,
  },
};

const pythonCode = createPythonCode(selectInput);
// Output: selected_region = 'US-West'

// Multi-select example
const multiSelectInput: InputSelectBlock = {
  id: "block-007",
  type: "input-select",
  sortingKey: "7",
  content: "",
  metadata: {
    deepnote_variable_name: "selected_regions",
    deepnote_variable_value: ["US-West", "EU"],
    deepnote_allow_multiple_values: true,
  },
};

const pythonCode2 = createPythonCode(multiSelectInput);
// Output: selected_regions = ['US-West', 'EU']
```

#### Slider input

Slider input generates a numeric Python variable assignment:

```typescript
import type { InputSliderBlock } from "@deepnote/blocks";

const sliderInput: InputSliderBlock = {
  id: "block-008",
  type: "input-slider",
  sortingKey: "8",
  content: "",
  metadata: {
    deepnote_variable_name: "threshold",
    deepnote_variable_value: "0.75",
    deepnote_slider_min_value: 0,
    deepnote_slider_max_value: 1,
    deepnote_slider_step: 0.05,
  },
};

const pythonCode = createPythonCode(sliderInput);
// Output: threshold = 0.75
```

#### Date range input

Date range inputs support multiple formats:

```typescript
import type { InputDateRangeBlock } from "@deepnote/blocks";

// Relative date range (past 7 days)
const relativeDateRange: InputDateRangeBlock = {
  id: "block-009",
  type: "input-date-range",
  sortingKey: "9",
  content: "",
  metadata: {
    deepnote_variable_name: "date_range",
    deepnote_variable_value: "past7days",
  },
};

const pythonCode = createPythonCode(relativeDateRange);
// Output:
// from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
// date_range = [
//   _deepnote_datetime.now().date() - _deepnote_timedelta(days=7),
//   _deepnote_datetime.now().date()
// ]

// Absolute date range
const absoluteDateRange: InputDateRangeBlock = {
  id: "block-010",
  type: "input-date-range",
  sortingKey: "10",
  content: "",
  metadata: {
    deepnote_variable_name: "custom_range",
    deepnote_variable_value: ["2024-01-01", "2024-12-31"],
  },
};

// Custom days range
const customDaysRange: InputDateRangeBlock = {
  id: "block-011",
  type: "input-date-range",
  sortingKey: "11",
  content: "",
  metadata: {
    deepnote_variable_name: "last_30_days",
    deepnote_variable_value: "customDays30",
  },
};
```

**Supported relative ranges:**

- `'past7days'` - Last 7 days
- `'past14days'` - Last 14 days
- `'pastMonth'` - Last 30 days
- `'past3months'` - Last 90 days
- `'past6months'` - Last 180 days
- `'pastYear'` - Last 365 days
- `'customDaysN'` - Last N days (e.g., `'customDays45'`)

#### Date input

Single date inputs support both absolute and relative formats:

```typescript
import type { InputDateBlock } from "@deepnote/blocks";

// Absolute date
const absoluteDate: InputDateBlock = {
  id: "block-date-1",
  type: "input-date",
  sortingKey: "d1",
  content: "",
  metadata: {
    deepnote_variable_name: "start_date",
    deepnote_variable_value: "2024-01-15",
  },
};

const pythonCode = createPythonCode(absoluteDate);
// Output:
// from datetime import datetime as _deepnote_datetime
// start_date = _deepnote_datetime.strptime('2024-01-15', '%Y-%m-%d').date()

// Relative date (today)
const relativeDate: InputDateBlock = {
  id: "block-date-2",
  type: "input-date",
  sortingKey: "d2",
  content: "",
  metadata: {
    deepnote_variable_name: "today",
    deepnote_variable_value: "today",
  },
};

const pythonCode2 = createPythonCode(relativeDate);
// Output:
// from datetime import datetime as _deepnote_datetime
// today = _deepnote_datetime.now().date()
```

**Supported date formats:**

- **Absolute dates**: ISO 8601 format `YYYY-MM-DD` (e.g., `"2024-01-15"`)
- **Relative dates**: `"today"` for current date
- **Date ranges**: Arrays of two dates `["2024-01-01", "2024-12-31"]` or relative range strings

All dates are converted to Python `datetime.date` objects for use in your code.

### Visualization blocks

Visualization blocks are blocks like charts and graphs that use Vega-Lite specifications powered by [Deepnote's VegaFusion fork](https://github.com/deepnote/vegafusion):

```typescript
import type { VisualizationBlock } from "@deepnote/blocks";

const chartBlock: VisualizationBlock = {
  id: "block-012",
  type: "visualization",
  sortingKey: "12",
  content: "",
  metadata: {
    deepnote_variable_name: "sales_chart",
    deepnote_chart_spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { name: "df" },
      mark: "bar",
      encoding: {
        x: { field: "month", type: "ordinal" },
        y: { field: "sales", type: "quantitative" },
      },
    },
  },
};

const pythonCode = createPythonCode(chartBlock);
// Output:
// from deepnote_toolkit import chart
// sales_chart = chart(df, {...})
```

**Note:** Deepnote uses [VegaFusion](https://github.com/deepnote/vegafusion), an optimized fork of Vega-Lite that provides server-side rendering and improved performance for large datasets.

### Button blocks

Button blocks can trigger variable updates:

```typescript
import type { ButtonBlock } from "@deepnote/blocks";

const buttonBlock: ButtonBlock = {
  id: "block-013",
  type: "button",
  sortingKey: "13",
  content: "Refresh Data",
  metadata: {
    deepnote_button_variable_name: "refresh_trigger",
    deepnote_button_variable_value: "timestamp",
  },
};

// Requires execution context
const pythonCode = createPythonCode(buttonBlock, {
  timestamp: "2024-01-27T12:00:00Z",
});
// Output: refresh_trigger = '2024-01-27T12:00:00Z'
```

### Big number blocks

Big Number blocks are specialized display blocks for showing key performance indicators (KPIs) and metrics in a prominent, formatted way. They evaluate Python expressions and display the result using customizable Jinja2 templates.

**What is a Big Number Block?**

A Big Number block:

- Executes a Python expression to compute a value
- Formats the value using a Jinja2 template
- Displays the result prominently in the notebook
- Commonly used for dashboards, reports, and KPI tracking

**Basic Example:**

```typescript
import type { BigNumberBlock } from "@deepnote/blocks";

const bigNumberBlock: BigNumberBlock = {
  id: "block-014",
  type: "big-number",
  sortingKey: "14",
  content: "",
  metadata: {
    deepnote_variable_name: "total_revenue",
    deepnote_big_number_template: "{{ value | currency }}",
    deepnote_big_number_value_source: 'df["revenue"].sum()',
  },
};

const pythonCode = createPythonCode(bigNumberBlock);
// Output:
// from deepnote_toolkit import big_number
// total_revenue = big_number(df["revenue"].sum(), template='{{ value | currency }}')
```

**Template Formatting:**

Big Number blocks support various Jinja2 filters for formatting:

```typescript
// Currency formatting
deepnote_big_number_template: "{{ value | currency }}";
// Result: $1,234,567.89

// Percentage formatting
deepnote_big_number_template: "{{ value | percentage }}";
// Result: 45.2%

// Number with custom precision
deepnote_big_number_template: "{{ value | round(2) }}";
// Result: 123.45

// Custom text with value
deepnote_big_number_template: "Total: {{ value | number }}";
// Result: Total: 1,234
```

**Common Use Cases:**

```typescript
// Total sales
const totalSales: BigNumberBlock = {
  id: "bn-1",
  type: "big-number",
  sortingKey: "1",
  content: "",
  metadata: {
    deepnote_variable_name: "total_sales",
    deepnote_big_number_template: "{{ value | currency }}",
    deepnote_big_number_value_source: 'sales_df["amount"].sum()',
  },
};

// Conversion rate
const conversionRate: BigNumberBlock = {
  id: "bn-2",
  type: "big-number",
  sortingKey: "2",
  content: "",
  metadata: {
    deepnote_variable_name: "conversion_rate",
    deepnote_big_number_template: "{{ value | percentage }}",
    deepnote_big_number_value_source: "(conversions / visits) * 100",
  },
};

// Active users count
const activeUsers: BigNumberBlock = {
  id: "bn-3",
  type: "big-number",
  sortingKey: "3",
  content: "",
  metadata: {
    deepnote_variable_name: "active_users",
    deepnote_big_number_template: "{{ value | number }}",
    deepnote_big_number_value_source: 'users_df["active"].sum()',
  },
};
```

## Markdown conversion

Text blocks can be converted to and from markdown:

```typescript
import { createMarkdown, stripMarkdown } from "@deepnote/blocks";

// Heading blocks
const h1Block = {
  type: "text-cell-h1",
  content: "Main Title",
  // ...
};
createMarkdown(h1Block); // "# Main Title"

// Bullet lists
const bulletBlock = {
  type: "text-cell-bullet",
  content: "List item",
  // ...
};
createMarkdown(bulletBlock); // "- List item"

// Todo items
const todoBlock = {
  type: "text-cell-todo",
  content: "Complete task",
  metadata: { checked: true },
  // ...
};
createMarkdown(todoBlock); // "- [x] Complete task"

// Callouts
const calloutBlock = {
  type: "text-cell-callout",
  content: "Important note",
  metadata: { color: "blue" },
  // ...
};
createMarkdown(calloutBlock); // "> Important note"

// Strip markdown formatting
stripMarkdown(h1Block); // "Main Title"
```

## Block type guards

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
} from "@deepnote/blocks";

function processBlock(block: DeepnoteBlock) {
  if (isCodeBlock(block)) {
    // TypeScript knows block is CodeBlock
    console.log("Code:", block.content);
  } else if (isSqlBlock(block)) {
    // TypeScript knows block is SqlBlock
    console.log("Query:", block.content);
    console.log("Variable:", block.metadata.deepnote_variable_name);
  } else if (isInputTextBlock(block)) {
    // TypeScript knows block is InputTextBlock
    console.log("Input value:", block.metadata.deepnote_variable_value);
  }
}
```

## File schema validation

The package includes Zod schemas for validating `.deepnote` files:

```typescript
import { deepnoteFileSchema, type DeepnoteFile } from "@deepnote/blocks";

// Validate a Deepnote file
const fileData = {
  metadata: {
    createdAt: "2025-01-27T12:00:00Z",
  },
  version: "1.0.0",
  project: {
    id: "project-123",
    name: "My Project",
    notebooks: [
      {
        id: "notebook-001",
        name: "Analysis",
        blocks: [],
        executionMode: "block",
        isModule: false,
      },
    ],
    integrations: [],
    settings: {},
  },
};

const result = deepnoteFileSchema.safeParse(fileData);
if (result.success) {
  const validFile: DeepnoteFile = result.data;
  console.log("Valid Deepnote file");
} else {
  console.error("Validation errors:", result.error);
}
```

## Error handling

The package throws specific errors for unsupported operations:

```typescript
import { createPythonCode, UnsupportedBlockTypeError } from "@deepnote/blocks";

try {
  const pythonCode = createPythonCode(block);
} catch (error) {
  if (error instanceof UnsupportedBlockTypeError) {
    console.error(
      "Block type not supported for Python generation:",
      error.message,
    );
  }
}
```

## Advanced usage

### Custom block processing

```typescript
import { createPythonCode, type DeepnoteBlock } from "@deepnote/blocks";

function processNotebook(blocks: DeepnoteBlock[]): string {
  const pythonCode = blocks
    .filter((block) => {
      // Only process executable blocks
      return ["code", "sql", "input-text", "input-checkbox"].includes(
        block.type,
      );
    })
    .map((block) => {
      try {
        return createPythonCode(block);
      } catch (error) {
        console.warn(`Skipping block ${block.id}: ${error.message}`);
        return null;
      }
    })
    .filter((code) => code !== null)
    .join("\n\n");

  return pythonCode;
}
```

### Batch conversion

```typescript
import { createPythonCode } from "@deepnote/blocks";
import type { DeepnoteFile } from "@deepnote/blocks";

function convertProjectToPython(
  deepnoteFile: DeepnoteFile,
): Map<string, string> {
  const notebookScripts = new Map<string, string>();

  for (const notebook of deepnoteFile.project.notebooks) {
    const pythonCode = notebook.blocks
      .map((block) => {
        try {
          return createPythonCode(block);
        } catch {
          return null;
        }
      })
      .filter((code) => code !== null)
      .join("\n\n");

    notebookScripts.set(notebook.name, pythonCode);
  }

  return notebookScripts;
}
```

## TypeScript types reference

### Core types

```typescript
// Base block interface
interface DeepnoteBlock {
  id: string;
  type: string;
  sortingKey: string;
  blockGroup?: string;
  content?: string;
  executionCount?: number;
  version?: number;
  metadata?: Record<string, any>;
  outputs?: any[];
}

// Executable block metadata
interface ExecutableBlockMetadata {
  deepnote_cell_height?: number;
  deepnote_to_be_reexecuted?: boolean;
  // ... other execution-related metadata
}

// Table state for DataFrames
interface TableState {
  sortBy: any[];
  filters: any[];
  pageSize: number;
  pageIndex: number;
  columnOrder: string[];
  hiddenColumnIds: string[];
  columnDisplayNames: any[];
  conditionalFilters: any[];
  cellFormattingRules: any[];
  wrappedTextColumnIds: string[];
}
```

### Block-specific types

See the [Supported Code Blocks](https://deepnote.com/docs/supported-code-blocks) documentation for detailed type definitions for each block type.

## Resources

- [GitHub Repository](https://github.com/deepnote/deepnote)
- [Package Source](https://github.com/deepnote/deepnote/tree/main/packages/blocks)
- [NPM Package](https://www.npmjs.com/package/@deepnote/blocks)
