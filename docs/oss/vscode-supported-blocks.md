---
title: Supported Block Types in VS Code Extension
description: Complete reference for Deepnote block types supported in the VS Code extension for local development and execution.
noIndex: false
noContent: false
---

# Supported Block Types in VS Code Extension

The Deepnote VS Code extension allows you to work with Deepnote notebooks locally. This document outlines which block types are supported for local execution and how they work in the VS Code environment.

## Overview

The VS Code extension uses the `@deepnote/blocks` package to convert Deepnote blocks into executable Python code. This enables you to run Deepnote notebooks locally with your own Python environment.

## Fully Supported Block Types

These block types are fully supported and can be executed locally in VS Code:

### 1. Code Blocks (`code`)

**Support Level:** ✅ **Fully Supported**

Standard Python code blocks work exactly as they do in Deepnote.

**Features:**
- Execute Python code
- Display outputs (text, DataFrames, plots)
- DataFrame table state configuration
- Execution counts

**Example:**
```python
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('data.csv')
df.head()
```

**Local Requirements:**
- Python environment with required packages
- `deepnote-toolkit` for DataFrame formatting

---

### 2. SQL Blocks (`sql`)

**Support Level:** ✅ **Fully Supported**

Execute SQL queries against connected databases.

**Features:**
- Query execution with variable assignment
- Support for multiple database types
- DataFrame or QueryPreview output
- Table state configuration

**Example:**
```sql
SELECT customer_id, SUM(amount) as total
FROM orders
WHERE order_date >= '2024-01-01'
GROUP BY customer_id
```

**Local Requirements:**
- `deepnote-toolkit` installed
- Database drivers (e.g., `psycopg2`, `pymysql`, `snowflake-connector-python`)
- Environment variables with connection details

**Environment Variable Format:**
```bash
export SQL_POSTGRES_PROD='{"host":"localhost","port":5432,"database":"mydb","username":"user","password":"pass"}'
```

---

### 3. Input Blocks

All input block types are fully supported for local execution:

#### Text Input (`input-text`)
**Support Level:** ✅ **Fully Supported**

Single-line text input that generates Python variable assignments.

**Generated Code:**
```python
api_key = 'sk-1234567890abcdef'
```

#### Textarea Input (`input-textarea`)
**Support Level:** ✅ **Fully Supported**

Multi-line text input for longer content.

**Generated Code:**
```python
sql_query = 'SELECT * FROM users\nWHERE created_at > \'2024-01-01\''
```

#### Checkbox Input (`input-checkbox`)
**Support Level:** ✅ **Fully Supported**

Boolean checkbox input.

**Generated Code:**
```python
include_test_data = True
```

#### Select Input (`input-select`)
**Support Level:** ✅ **Fully Supported**

Dropdown selection (single or multiple values).

**Generated Code:**
```python
# Single select
environment = 'production'

# Multi-select
selected_regions = ['us-east-1', 'eu-west-1']
```

#### Slider Input (`input-slider`)
**Support Level:** ✅ **Fully Supported**

Numeric slider input.

**Generated Code:**
```python
confidence_threshold = 0.85
```

#### File Input (`input-file`)
**Support Level:** ✅ **Fully Supported**

File path selector.

**Generated Code:**
```python
data_file = '/work/data/sales_2024.csv'
```

#### Date Input (`input-date`)
**Support Level:** ✅ **Fully Supported**

Single date picker.

**Generated Code:**
```python
from dateutil.parser import parse as _deepnote_parse
report_date = _deepnote_parse('2024-01-27').date()
```

#### Date Range Input (`input-date-range`)
**Support Level:** ✅ **Fully Supported**

Date range picker with relative and absolute ranges.

**Generated Code:**
```python
from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
analysis_period = [
  _deepnote_datetime.now().date() - _deepnote_timedelta(days=7),
  _deepnote_datetime.now().date()
]
```

**Supported Relative Ranges:**
- `past7days`, `past14days`, `pastMonth`
- `past3months`, `past6months`, `pastYear`
- `customDaysN` (e.g., `customDays45`)

---

### 4. Visualization Blocks (`visualization`)

**Support Level:** ✅ **Fully Supported**

Interactive charts using Vega-Lite specifications.

**Features:**
- Vega-Lite chart rendering
- Data filtering
- Variable assignment

**Generated Code:**
```python
from deepnote_toolkit import chart
sales_chart = chart(df, {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "mark": "bar",
  "encoding": {...}
})
```

**Local Requirements:**
- `deepnote-toolkit` with chart support
- `altair` or `vega` libraries

---

### 5. Big Number Blocks (`big-number`)

**Support Level:** ✅ **Fully Supported**

Display KPIs with Jinja2 templates.

**Features:**
- Numeric value display
- Template formatting
- Comparison values

**Generated Code:**
```python
from deepnote_toolkit import big_number
total_revenue = big_number(
  df["revenue"].sum(),
  template='{{ value | currency }}'
)
```

**Local Requirements:**
- `deepnote-toolkit` installed

---

### 6. Button Blocks (`button`)

**Support Level:** ✅ **Fully Supported**

Interactive buttons with variable control.

**Features:**
- Variable state management
- Execution context support

**Generated Code:**
```python
# When button is clicked
refresh_trigger = True

# When button is not clicked
refresh_trigger = False
```

**Note:** Button state is managed through execution context in local environments.

---

## Text Blocks

Text blocks are converted to markdown for documentation purposes:

### Supported Text Block Types

- **Headings** (`text-cell-h1`, `text-cell-h2`, `text-cell-h3`) - ✅ Converted to markdown
- **Paragraphs** (`text-cell-p`) - ✅ Converted to markdown
- **Bullet Lists** (`text-cell-bullet`) - ✅ Converted to markdown
- **Todo Items** (`text-cell-todo`) - ✅ Converted to markdown
- **Callouts** (`text-cell-callout`) - ✅ Converted to markdown
- **Separators** (`separator`) - ✅ Converted to `<hr>`
- **Images** (`image`) - ✅ Converted to markdown image syntax

**Markdown Conversion:**
Text blocks are converted to markdown format for display in VS Code notebooks or exported as markdown files.

---

## Unsupported Block Types

The following block types are **not yet supported** for local execution in VS Code:

### ⚠️ Limited or No Support

- **Custom App Blocks** - Not supported (requires Deepnote runtime)
- **Third-party Integration Blocks** - Limited support (depends on integration type)
- **Proprietary Visualization Types** - Not supported (Deepnote-specific)
- **Real-time Collaboration Features** - Not supported (cloud-only)

**Error Handling:**
When encountering unsupported block types, the extension will throw an `UnsupportedBlockTypeError`:

```typescript
throw new UnsupportedBlockTypeError(
  `Creating python code from block type ${block.type} is not supported yet.`
)
```

---

## Local Execution Requirements

### Required Packages

To execute Deepnote notebooks locally, you need:

1. **deepnote-toolkit** (required for most blocks):
   ```bash
   pip install deepnote-toolkit
   ```

2. **Database drivers** (for SQL blocks):
   ```bash
   # PostgreSQL
   pip install psycopg2-binary
   
   # MySQL
   pip install pymysql
   
   # Snowflake
   pip install snowflake-connector-python
   
   # BigQuery
   pip install google-cloud-bigquery
   ```

3. **Visualization libraries** (for chart blocks):
   ```bash
   pip install altair vega
   ```

4. **Data analysis libraries** (commonly used):
   ```bash
   pip install pandas numpy matplotlib seaborn
   ```

### Environment Configuration

Set up environment variables for database connections:

```bash
# PostgreSQL example
export SQL_POSTGRES_PROD='{"host":"localhost","port":5432,"database":"analytics","username":"user","password":"pass"}'

# Snowflake example
export SQL_SNOWFLAKE_WAREHOUSE='{"account":"xy12345","user":"analyst","password":"pass","warehouse":"COMPUTE_WH","database":"ANALYTICS"}'
```

### Python Version

- **Recommended:** Python 3.9 or higher
- **Minimum:** Python 3.8

---

## VS Code Extension Features

### Execution Modes

The VS Code extension supports two execution modes:

1. **Block Mode** (default)
   - Execute blocks independently
   - Each block can be run individually
   - No automatic dependency tracking

2. **Downstream Mode**
   - Execute dependent blocks automatically
   - Requires dependency analysis

### Output Display

Supported output types:
- ✅ Text output (stdout, stderr)
- ✅ DataFrames (rendered as tables)
- ✅ Plots (matplotlib, seaborn, altair)
- ✅ HTML output
- ✅ Images
- ✅ JSON/dict pretty-printing

### Variable Inspector

View all variables in the current notebook scope:
- Variable names
- Types
- Values (for simple types)
- DataFrame shapes

---

## Block Conversion Process

### How It Works

1. **Parse `.deepnote` file** - Read YAML format
2. **Identify block types** - Determine which blocks can be executed
3. **Generate Python code** - Convert blocks to executable Python
4. **Execute in kernel** - Run code in local Python environment
5. **Display outputs** - Show results in VS Code

### Example Conversion

**Deepnote Block (YAML):**
```yaml
- id: block-001
  type: sql
  content: SELECT * FROM users LIMIT 10
  metadata:
    deepnote_variable_name: users_df
    sql_integration_id: postgres-prod
```

**Generated Python:**
```python
if '_dntk' in globals():
  _dntk.dataframe_utils.configure_dataframe_formatter('{}')
else:
  _deepnote_current_table_attrs = '{}'

users_df = _dntk.execute_sql(
  'SELECT * FROM users LIMIT 10',
  'SQL_POSTGRES_PROD',
  audit_sql_comment='',
  sql_cache_mode='cache_disabled',
  return_variable_type='dataframe'
)
users_df
```

---

## Limitations and Workarounds

### Known Limitations

1. **No Real-time Collaboration**
   - VS Code execution is single-user
   - Use git for version control and collaboration

2. **Limited Integration Support**
   - Some Deepnote integrations require cloud infrastructure
   - Use local database connections instead

3. **No Built-in Scheduling**
   - Use cron jobs or task schedulers for automation

4. **Different Execution Environment**
   - Local environment may differ from Deepnote cloud
   - Use Docker for consistent environments

### Workarounds

**For Unsupported Integrations:**
```python
# Instead of Deepnote integration
# Use direct connection
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    database="mydb",
    user="user",
    password="pass"
)
```

**For Custom Visualizations:**
```python
# Use standard Python libraries
import matplotlib.pyplot as plt
import seaborn as sns

plt.figure(figsize=(10, 6))
sns.barplot(data=df, x='category', y='value')
plt.show()
```

---

## Best Practices

### 1. Use Requirements File

Create a `requirements.txt` for your notebook:

```txt
deepnote-toolkit>=1.0.0
pandas>=2.0.0
numpy>=1.24.0
matplotlib>=3.7.0
psycopg2-binary>=2.9.0
```

### 2. Environment Variables

Store connection details in `.env` file:

```bash
# .env
SQL_POSTGRES_PROD={"host":"localhost","port":5432,...}
SQL_SNOWFLAKE_WAREHOUSE={"account":"xy12345",...}
```

Load in notebook:
```python
from dotenv import load_dotenv
load_dotenv()
```

### 3. Modular Notebooks

Split complex notebooks into modules:
- Data loading notebook
- Processing notebook
- Analysis notebook
- Visualization notebook

### 4. Test Locally First

Before deploying to Deepnote cloud:
1. Test all blocks locally in VS Code
2. Verify outputs match expectations
3. Check for environment-specific issues

### 5. Document Dependencies

Add a markdown block at the top of your notebook:

```markdown
# Requirements

- Python 3.9+
- deepnote-toolkit
- PostgreSQL connection to `analytics` database
- Environment variables: SQL_POSTGRES_PROD
```

---

## Troubleshooting

### Block Not Executing

**Problem:** Block shows `UnsupportedBlockTypeError`

**Solution:**
1. Check if block type is in supported list
2. Update `@deepnote/blocks` package
3. Convert to supported block type

### SQL Block Fails

**Problem:** `ConnectionError` or `EnvironmentError`

**Solution:**
1. Verify environment variable is set: `echo $SQL_POSTGRES_PROD`
2. Check database connection manually
3. Install required database driver
4. Verify integration ID matches environment variable name

### Import Errors

**Problem:** `ModuleNotFoundError: No module named 'deepnote_toolkit'`

**Solution:**
```bash
pip install deepnote-toolkit
```

### DataFrame Not Displaying

**Problem:** DataFrame shows as text instead of table

**Solution:**
1. Ensure `deepnote-toolkit` is installed
2. Check VS Code notebook renderer settings
3. Use `display(df)` instead of just `df`

---

## Migration Guide

### From Deepnote Cloud to VS Code

1. **Export notebook** as `.deepnote` file
2. **Install dependencies** locally
3. **Set up environment variables** for integrations
4. **Test execution** block by block
5. **Fix any compatibility issues**

### From Jupyter to Deepnote Format

1. **Convert** using `@deepnote/convert` package:
   ```bash
   deepnote-convert notebook.ipynb -o notebook.deepnote
   ```

2. **Review block types** - ensure all are supported
3. **Add metadata** for input blocks if needed
4. **Test in VS Code**

---

## Related Documentation

- [Blocks Package](./blocks-package.md) - Complete package API reference
- [Supported Code Blocks](./supported-code-blocks.md) - Detailed block type reference
- [SQL Blocks](./sql-blocks.md) - SQL block documentation
- [Deepnote Format](./deepnote-format.md) - File format specification
- [Local Setup](./local-setup.md) - Setting up local development environment

## Resources

- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=deepnote.deepnote)
- [deepnote-toolkit PyPI](https://pypi.org/project/deepnote-toolkit/)
- [GitHub Repository](https://github.com/deepnote/deepnote)
- [Deepnote Documentation](https://docs.deepnote.com)
