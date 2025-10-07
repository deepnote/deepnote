# @deepnote/blocks

The blocks package defines the Deepnote Blocks.

## Overview

This package provides TypeScript types and utilities for working with Deepnote notebook blocks, including:

- **Block Types**: Code, SQL, Text, Markdown, Input, Visualization, Button, Big Number, Image, Separator
- **Python Code Generation**: Convert blocks to executable Python code
- **Markdown Conversion**: Convert text blocks to/from markdown format

## Supported Block Types

### Code & Data Blocks

- **code**: Python code execution
- **sql**: SQL query execution with variable assignment

### Input Blocks

- **input-text**: Single-line text input
- **input-textarea**: Multi-line text input
- **input-checkbox**: Boolean checkbox
- **input-select**: Single or multi-select dropdown
- **input-slider**: Numeric slider
- **input-file**: File path selector
- **input-date**: Date picker
- **input-date-range**: Date range with presets (past 7 days, past month, etc.)

### Display Blocks

- **visualization**: Interactive charts using Vega-Lite
- **big-number**: KPI display with Jinja2 templates
- **button**: Interactive button with variable control

### Text & Markdown Blocks

- **text-cell-h1/h2/h3**: Headings
- **text-cell-p**: Paragraphs
- **text-cell-bullet**: Bullet lists
- **text-cell-todo**: Checkboxes
- **text-cell-callout**: Highlighted notes
- **separator**: Horizontal rule (`<hr>`)
- **image**: Embedded images with alignment and sizing

## Usage

### Python Code Generation

```typescript
import { createPythonCode } from "@deepnote/blocks";

// Code block
const codeBlock = {
  type: "code",
  content: 'print("Hello, world!")',
  // ...
};
createPythonCode(codeBlock); // 'print("Hello, world!")'

// SQL block
const sqlBlock = {
  type: "sql",
  content: "SELECT * FROM users",
  metadata: {
    deepnote_variable_name: "df_users",
    sql_integration_id: "abc-123",
  },
  // ...
};
createPythonCode(sqlBlock);
// df_users = _dntk.execute_sql('SELECT * FROM users', 'SQL_ABC_123', ...)

// Input checkbox
const checkboxBlock = {
  type: "input-checkbox",
  metadata: {
    deepnote_variable_name: "is_enabled",
    deepnote_variable_value: true,
  },
  // ...
};
createPythonCode(checkboxBlock); // is_enabled = True

// Input date range
const dateRangeBlock = {
  type: "input-date-range",
  metadata: {
    deepnote_variable_name: "date_range",
    deepnote_variable_value: "past7days",
  },
  // ...
};
createPythonCode(dateRangeBlock);
// from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
// date_range = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=7), ...]
```

### Markdown Conversion

```typescript
import { createMarkdown, stripMarkdown } from "@deepnote/blocks";

const headingBlock = {
  type: "text-cell-h1",
  content: "Main Title",
  // ...
};

const markdown = createMarkdown(headingBlock); // "# Main Title"
const plainText = stripMarkdown(headingBlock); // "Main Title"

const todoBlock = {
  type: "text-cell-todo",
  content: "Complete task",
  metadata: { checked: true },
  // ...
};

createMarkdown(todoBlock); // "- [x] Complete task"

const separatorBlock = {
  type: "separator",
  content: "",
  // ...
};

createMarkdown(separatorBlock); // "<hr>"

const imageBlock = {
  type: "image",
  content: "",
  metadata: {
    deepnote_img_src: "https://example.com/image.png",
    deepnote_img_width: "500",
    deepnote_img_alignment: "center",
  },
  // ...
};

createMarkdown(imageBlock); // '<img src="https://example.com/image.png" width="500" align="center" />'
```
