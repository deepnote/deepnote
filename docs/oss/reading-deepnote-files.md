---
title: Reading .deepnote Files in Your IDE
description: Complete guide to understanding, reading, and working with Deepnote's YAML file format in your favorite IDE or text editor.
noIndex: false
noContent: false
---

# Reading .deepnote Files in Your IDE

Deepnote uses a human-readable YAML format (`.deepnote` files) that you can open and edit in any text editor or IDE. This guide will help you understand the file structure and work with Deepnote notebooks locally.

## Why YAML Format?

Unlike Jupyter's JSON format, Deepnote's YAML format is designed to be:

- **Human-readable** - Easy to read and understand
- **Git-friendly** - Clean diffs for version control
- **Easy to edit** - Modify notebooks in any text editor
- **Structured** - Clear hierarchy and organization
- **Extensible** - Easy to add new features

## Opening .deepnote Files

### In Your IDE

`.deepnote` files are plain text YAML files. You can open them in:

- **VS Code** - Best experience with YAML extension
- **IntelliJ/WebStorm** - Built-in YAML support
- **Sublime Text** - With YAML syntax highlighting
- **Vim/Neovim** - With YAML plugins
- **Emacs** - With yaml-mode
- **Any text editor** - Works as plain text

### Recommended VS Code Extensions

For the best experience in VS Code, install:

1. **YAML** by Red Hat
   - Syntax highlighting
   - Schema validation
   - Auto-completion
   - Error detection

2. **Deepnote** (official extension)
   - Native `.deepnote` file support
   - Block execution
   - Output rendering

## File Structure Overview

A `.deepnote` file has three main sections:

```yaml
metadata:          # File-level metadata
  createdAt: '2025-01-27T12:00:00Z'
  modifiedAt: '2025-01-27T14:30:00Z'

version: '1.0.0'   # File format version

project:           # Project content
  id: 'project-uuid'
  name: 'My Project'
  notebooks: [...]
  integrations: [...]
  settings: {...}
```

## Understanding the Metadata Section

The metadata section contains file-level information:

```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'      # When project was created
  modifiedAt: '2025-01-27T14:30:00Z'     # Last modification time
  exportedAt: '2025-01-27T15:00:00Z'     # When file was exported
  checksum: 'abc123def456...'            # Optional integrity hash
```

**What You Can Do:**
- ✅ Read timestamps to track changes
- ✅ Use checksum for file integrity verification
- ⚠️ Avoid manually editing (auto-generated)

## Understanding the Project Section

### Project Properties

```yaml
project:
  id: 'abc-123-def-456'           # Unique project identifier
  name: 'Sales Analysis Q4'       # Human-readable name
  initNotebookId: 'notebook-001'  # Default notebook to open
```

**Editing Tips:**
- ✅ Change `name` to rename your project
- ⚠️ Don't change `id` (breaks references)
- ✅ Set `initNotebookId` to change default notebook

### Notebooks Array

Each project can contain multiple notebooks:

```yaml
project:
  notebooks:
    - id: 'notebook-001'
      name: 'Data Loading'
      executionMode: 'block'
      isModule: false
      workingDirectory: '/work'
      blocks: [...]
    
    - id: 'notebook-002'
      name: 'Analysis'
      executionMode: 'downstream'
      isModule: false
      blocks: [...]
```

**Key Properties:**
- `id` - Unique notebook identifier
- `name` - Notebook display name
- `executionMode` - `'block'` or `'downstream'`
- `isModule` - Whether notebook is reusable
- `workingDirectory` - Working directory path
- `blocks` - Array of notebook blocks

**Editing Tips:**
- ✅ Rename notebooks by changing `name`
- ✅ Change execution mode
- ✅ Mark notebooks as modules
- ⚠️ Don't change `id` values

### Integrations Array

Connected data sources and services:

```yaml
project:
  integrations:
    - id: 'integration-001'
      name: 'Production Database'
      type: 'postgres'
    
    - id: 'integration-002'
      name: 'Data Warehouse'
      type: 'snowflake'
```

**Integration Types:**
- `postgres`, `mysql`, `mariadb`
- `snowflake`, `bigquery`, `redshift`
- `databricks`, `clickhouse`
- `mongodb`, `elasticsearch`

**Editing Tips:**
- ✅ Add new integrations
- ✅ Rename integrations
- ⚠️ Connection details stored separately (environment variables)

### Settings Object

Project-wide configuration:

```yaml
project:
  settings:
    environment:
      pythonVersion: '3.11'
      customImage: 'my-custom-image:latest'
    
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
      - 'scikit-learn>=1.3.0'
    
    sqlCacheMaxAge: 3600  # SQL cache duration in seconds
```

**Editing Tips:**
- ✅ Change Python version
- ✅ Add/remove package requirements
- ✅ Adjust SQL cache settings
- ✅ Specify custom Docker images

## Understanding Blocks

Blocks are the core content of notebooks. Each block has a common structure:

```yaml
blocks:
  - id: 'block-001'              # Unique block identifier
    type: 'code'                 # Block type
    sortingKey: '1'              # Position in notebook
    blockGroup: 'group-uuid'     # Optional grouping
    content: |                   # Block content
      import pandas as pd
      df = pd.read_csv('data.csv')
    executionCount: 1            # Times executed
    version: 1                   # Block schema version
    metadata:                    # Block-specific settings
      deepnote_table_state: {...}
    outputs:                     # Execution outputs
      - output_type: 'execute_result'
        data: {...}
```

### Block Types

**Executable Blocks:**
- `code` - Python code
- `sql` - SQL queries

**Input Blocks:**
- `input-text` - Single-line text
- `input-textarea` - Multi-line text
- `input-checkbox` - Boolean
- `input-select` - Dropdown
- `input-slider` - Numeric slider
- `input-file` - File selector
- `input-date` - Date picker
- `input-date-range` - Date range

**Display Blocks:**
- `visualization` - Charts
- `big-number` - KPIs
- `button` - Interactive buttons

**Text Blocks:**
- `text-cell-h1`, `text-cell-h2`, `text-cell-h3` - Headings
- `text-cell-p` - Paragraphs
- `text-cell-bullet` - Bullet lists
- `text-cell-todo` - Todo items
- `text-cell-callout` - Callouts

**Media Blocks:**
- `image` - Images
- `separator` - Horizontal rules

### Reading Code Blocks

```yaml
- id: 'block-001'
  type: code
  sortingKey: '1'
  content: |
    import pandas as pd
    
    # Load data
    df = pd.read_csv('sales_data.csv')
    
    # Basic analysis
    print(f"Total rows: {len(df)}")
    print(f"Total sales: ${df['amount'].sum():,.2f}")
  executionCount: 3
  metadata:
    deepnote_cell_height: 200
```

**What to Look For:**
- `content` - The actual Python code
- `executionCount` - How many times it's been run
- `metadata.deepnote_cell_height` - Cell display height

### Reading SQL Blocks

```yaml
- id: 'block-002'
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
    sql_integration_id: postgres-prod
    deepnote_return_variable_type: dataframe
```

**What to Look For:**
- `content` - The SQL query
- `deepnote_variable_name` - Python variable name for results
- `sql_integration_id` - Which database to query
- `deepnote_return_variable_type` - Output format

### Reading Input Blocks

```yaml
- id: 'block-003'
  type: input-date-range
  sortingKey: '3'
  content: ''
  metadata:
    deepnote_variable_name: analysis_period
    deepnote_variable_value: past7days
```

**What to Look For:**
- `deepnote_variable_name` - Python variable name
- `deepnote_variable_value` - Current value
- Additional metadata for options, ranges, etc.

### Reading Text Blocks

```yaml
- id: 'block-004'
  type: text-cell-h1
  sortingKey: '4'
  content: 'Q4 Sales Analysis'
  metadata:
    formattedRanges: []

- id: 'block-005'
  type: text-cell-p
  sortingKey: '5'
  content: 'This notebook analyzes sales trends for Q4 2024.'
  metadata: {}
```

**What to Look For:**
- `content` - The text content
- `formattedRanges` - Text formatting (bold, italic, links)

## Block Ordering

Blocks are ordered using the `sortingKey` field with base-36 encoding:

```yaml
blocks:
  - id: 'block-001'
    sortingKey: '1'    # First block
  
  - id: 'block-002'
    sortingKey: '2'    # Second block
  
  - id: 'block-003'
    sortingKey: '1a'   # Inserted between 1 and 2
  
  - id: 'block-004'
    sortingKey: '3'    # Third block
```

**Understanding Sorting Keys:**
- Base-36 encoding: `0-9`, `a-z`
- Lexicographic ordering
- Allows insertion without renumbering
- Example sequence: `1`, `2`, `3`, `4`, `5`, ..., `9`, `a`, `b`, ..., `z`, `10`, `11`

## Reading Block Outputs

Blocks can store their execution outputs:

```yaml
outputs:
  - output_type: 'stream'
    name: 'stdout'
    text: 'Total rows: 1523\n'
  
  - output_type: 'execute_result'
    execution_count: 1
    data:
      text/plain: '   id  name  value\n0   1  Alice    100\n1   2   Bob    200'
      text/html: '<table>...</table>'
  
  - output_type: 'display_data'
    data:
      image/png: 'iVBORw0KGgoAAAANSUhEUg...'
```

**Output Types:**
- `stream` - Text output (stdout/stderr)
- `execute_result` - Return values
- `display_data` - Rich media (plots, images)
- `error` - Error messages

## Practical Examples

### Example 1: Finding All SQL Queries

Search for all SQL blocks in your notebook:

```bash
# Using grep
grep -A 10 "type: sql" notebook.deepnote

# Using yq (YAML query tool)
yq '.project.notebooks[].blocks[] | select(.type == "sql") | .content' notebook.deepnote
```

### Example 2: Listing All Variables

Find all variables defined in input blocks:

```bash
yq '.project.notebooks[].blocks[] | select(.type | startswith("input-")) | .metadata.deepnote_variable_name' notebook.deepnote
```

### Example 3: Checking Python Version

```bash
yq '.project.settings.environment.pythonVersion' notebook.deepnote
```

### Example 4: Listing Dependencies

```bash
yq '.project.settings.requirements[]' notebook.deepnote
```

### Example 5: Finding Specific Code

Search for code containing specific text:

```bash
yq '.project.notebooks[].blocks[] | select(.type == "code" and (.content | contains("pandas"))) | .content' notebook.deepnote
```

## Editing .deepnote Files

### Safe Edits

These edits are generally safe:

✅ **Change project name:**
```yaml
project:
  name: 'New Project Name'  # Safe to edit
```

✅ **Change notebook names:**
```yaml
notebooks:
  - name: 'New Notebook Name'  # Safe to edit
```

✅ **Update block content:**
```yaml
blocks:
  - content: |  # Safe to edit
      # Your updated code here
```

✅ **Modify settings:**
```yaml
settings:
  requirements:  # Safe to add/remove
    - 'pandas>=2.0.0'
    - 'new-package>=1.0.0'
```

✅ **Change metadata values:**
```yaml
metadata:
  deepnote_variable_name: 'new_name'  # Safe to edit
  deepnote_variable_value: 'new_value'  # Safe to edit
```

### Dangerous Edits

Avoid these edits unless you know what you're doing:

⚠️ **Don't change IDs:**
```yaml
project:
  id: 'abc-123'  # DON'T CHANGE - breaks references

notebooks:
  - id: 'notebook-001'  # DON'T CHANGE

blocks:
  - id: 'block-001'  # DON'T CHANGE
```

⚠️ **Don't break YAML syntax:**
```yaml
# Bad - missing quotes
content: This will break

# Good - proper quoting
content: 'This is safe'
```

⚠️ **Don't modify version:**
```yaml
version: '1.0.0'  # DON'T CHANGE - format version
```

⚠️ **Be careful with sorting keys:**
```yaml
sortingKey: '1'  # Changing this affects block order
```

## Validating .deepnote Files

### Using Schema Validation

The `@deepnote/blocks` package includes Zod schemas for validation:

```typescript
import { deepnoteFileSchema } from '@deepnote/blocks'

const fileData = // ... load your YAML file
const result = deepnoteFileSchema.safeParse(fileData)

if (result.success) {
  console.log('Valid Deepnote file')
} else {
  console.error('Validation errors:', result.error)
}
```

### Using YAML Linters

Check YAML syntax:

```bash
# Using yamllint
yamllint notebook.deepnote

# Using yq
yq eval notebook.deepnote > /dev/null
```

### Common Validation Errors

**Missing required fields:**
```yaml
# Error: Missing 'id' field
blocks:
  - type: code
    content: 'print("hello")'
    # Missing: id, sortingKey
```

**Invalid types:**
```yaml
# Error: executionCount should be number
blocks:
  - id: 'block-001'
    executionCount: 'one'  # Should be: 1
```

**Invalid YAML syntax:**
```yaml
# Error: Improper indentation
blocks:
- id: 'block-001'
  type: code
 content: 'print("hello")'  # Wrong indentation
```

## Working with Multiple Notebooks

A single `.deepnote` file can contain multiple notebooks:

```yaml
project:
  notebooks:
    - id: 'notebook-001'
      name: 'Data Loading'
      blocks: [...]
    
    - id: 'notebook-002'
      name: 'Data Processing'
      blocks: [...]
    
    - id: 'notebook-003'
      name: 'Visualization'
      blocks: [...]
```

**Use Cases:**
- Organize related analyses
- Separate data loading from analysis
- Create reusable modules
- Build data pipelines

## Module Notebooks

Mark notebooks as modules for reuse:

```yaml
notebooks:
  - id: 'notebook-utils'
    name: 'Utility Functions'
    isModule: true  # This notebook is a module
    blocks:
      - type: code
        content: |
          def clean_data(df):
              # Cleaning logic
              return df
```

**Using Modules:**
```python
# In another notebook
from utility_functions import clean_data

df = clean_data(raw_df)
```

## Version Control Best Practices

### Git-Friendly Format

The YAML format produces clean diffs:

```diff
  blocks:
    - id: 'block-001'
      type: code
      content: |
-       print("Hello")
+       print("Hello, World!")
```

### .gitignore Recommendations

```gitignore
# Ignore output files
*.pyc
__pycache__/

# Ignore environment files
.env
.venv/

# Keep .deepnote files
!*.deepnote
```

### Commit Messages

Use descriptive commit messages:

```bash
git commit -m "Add SQL query for customer analysis"
git commit -m "Update data loading notebook with new source"
git commit -m "Fix pandas version in requirements"
```

## Troubleshooting

### File Won't Open

**Problem:** IDE shows errors when opening `.deepnote` file

**Solutions:**
1. Check YAML syntax with `yamllint`
2. Verify file encoding is UTF-8
3. Check for special characters
4. Validate against schema

### Blocks Not Executing

**Problem:** Blocks don't run in VS Code extension

**Solutions:**
1. Check block type is supported
2. Verify Python environment is set up
3. Check for missing dependencies
4. Review block metadata

### Corrupted File

**Problem:** File appears corrupted or unreadable

**Solutions:**
1. Check git history for last working version
2. Validate YAML syntax
3. Compare with backup
4. Use schema validation to identify issues

### Merge Conflicts

**Problem:** Git merge conflicts in `.deepnote` file

**Solutions:**
1. Use YAML-aware merge tools
2. Resolve conflicts in block order carefully
3. Validate file after merge
4. Test execution after resolving

## Advanced Tips

### Using jq/yq for Analysis

Extract specific information:

```bash
# Count blocks by type
yq '.project.notebooks[].blocks[].type' notebook.deepnote | sort | uniq -c

# Find all SQL queries
yq '.project.notebooks[].blocks[] | select(.type == "sql") | .content' notebook.deepnote

# List all variables
yq '.project.notebooks[].blocks[].metadata.deepnote_variable_name' notebook.deepnote | grep -v null

# Get total block count
yq '.project.notebooks[].blocks | length' notebook.deepnote
```

### Programmatic Reading

**Python:**
```python
import yaml

with open('notebook.deepnote', 'r') as f:
    data = yaml.safe_load(f)

# Access project name
print(data['project']['name'])

# Iterate through blocks
for notebook in data['project']['notebooks']:
    for block in notebook['blocks']:
        if block['type'] == 'code':
            print(f"Code block: {block['id']}")
```

**Node.js:**
```javascript
const yaml = require('js-yaml')
const fs = require('fs')

const data = yaml.load(fs.readFileSync('notebook.deepnote', 'utf8'))

// Access notebooks
data.project.notebooks.forEach(notebook => {
  console.log(`Notebook: ${notebook.name}`)
})
```

### Creating Templates

Create reusable notebook templates:

```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'

version: '1.0.0'

project:
  id: 'template-001'
  name: 'Data Analysis Template'
  
  notebooks:
    - id: 'notebook-001'
      name: 'Analysis'
      executionMode: 'block'
      blocks:
        - id: 'block-001'
          type: text-cell-h1
          sortingKey: '1'
          content: 'Data Analysis'
          metadata: {}
        
        - id: 'block-002'
          type: code
          sortingKey: '2'
          content: |
            import pandas as pd
            import numpy as np
            import matplotlib.pyplot as plt
            
            # Your analysis here
          metadata: {}
  
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
      - 'matplotlib>=3.7.0'
```

## Related Documentation

- [Deepnote Format](./deepnote-format.md) - Complete format specification
- [Supported Code Blocks](./supported-code-blocks.md) - All block types
- [Blocks Package](./blocks-package.md) - Package API reference
- [VS Code Supported Blocks](./vscode-supported-blocks.md) - VS Code extension guide
- [Converting Notebooks](./converting-notebooks.md) - Format conversion

## Resources

- [YAML Specification](https://yaml.org/spec/)
- [VS Code YAML Extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
- [yq Documentation](https://mikefarah.gitbook.io/yq/)
- [Deepnote GitHub](https://github.com/deepnote/deepnote)
