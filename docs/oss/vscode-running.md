---
title: Running .deepnote Files in VS Code
description: Complete guide to executing Deepnote notebooks in Visual Studio Code, including block execution, debugging, output management, and performance optimization.
noIndex: false
noContent: false
---

# Running .deepnote Files in VS Code

This guide covers everything you need to know about executing Deepnote notebooks in Visual Studio Code, from basic block execution to advanced debugging and optimization techniques.

## Prerequisites

Before running `.deepnote` files, ensure you have:

- ✅ VS Code installed
- ✅ Deepnote extension installed
- ✅ Python environment set up
- ✅ Required packages installed
- ✅ Database connections configured (if using SQL blocks)

## Opening .deepnote Files

### Open a Notebook

**Method 1: File Explorer**
1. Navigate to `.deepnote` file in Explorer
2. Double-click to open
3. Notebook opens in editor

**Method 2: Quick Open**
1. Press Ctrl/Cmd + P
2. Type notebook name
3. Press Enter

**Method 3: Command Line**
```bash
code notebook.deepnote
```

<!-- IMAGE: Screenshot of opening .deepnote file in VS Code -->
<!-- FILE: opening-deepnote-file.png -->
<!-- CAPTION: Opening a .deepnote file in VS Code -->

### Notebook Interface

**Main Components:**
- **Toolbar** - Execution controls and settings
- **Block cells** - Individual code/text blocks
- **Output panels** - Execution results
- **Status bar** - Kernel status and info

<!-- IMAGE: Screenshot of notebook interface with labeled components -->
<!-- FILE: notebook-interface-labeled.png -->
<!-- CAPTION: Deepnote notebook interface in VS Code -->

## Kernel Management

### Starting the Kernel

**Automatic Start:**
- Kernel starts automatically when opening notebook
- Status bar shows "Kernel: Starting..."
- Wait for "Kernel: Idle" status

**Manual Start:**
1. Click kernel status in status bar
2. Select "Start Kernel"
3. Or Command Palette → "Deepnote: Start Kernel"

<!-- IMAGE: Screenshot of kernel status indicator -->
<!-- FILE: kernel-status.png -->
<!-- CAPTION: Kernel status in VS Code status bar -->

### Selecting Python Interpreter

**Choose Interpreter:**
1. Click Python version in status bar
2. Or Ctrl/Cmd + Shift + P → "Python: Select Interpreter"
3. Choose from list:
   - Virtual environments (.venv)
   - Conda environments
   - System Python

<!-- IMAGE: Screenshot of Python interpreter selection -->
<!-- FILE: interpreter-selection.png -->
<!-- CAPTION: Selecting Python interpreter -->

### Restarting the Kernel

**When to Restart:**
- After installing packages
- When variables need clearing
- After import errors
- When kernel becomes unresponsive

**How to Restart:**
1. Click "Restart" in toolbar
2. Or Command Palette → "Deepnote: Restart Kernel"
3. Confirm restart

**Restart and Run All:**
- Clears all variables
- Re-executes all blocks
- Fresh start

<!-- IMAGE: Screenshot of restart kernel options -->
<!-- FILE: restart-kernel-options.png -->
<!-- CAPTION: Kernel restart options -->

## Executing Blocks

### Running Single Blocks

**Execute Current Block:**
- Click ▶ play button
- Or press Shift + Enter
- Block executes, cursor moves to next

**Execute and Stay:**
- Press Ctrl/Cmd + Enter
- Block executes, cursor stays

**Execute and Insert Below:**
- Press Alt/Option + Enter
- Block executes, new block inserted

<!-- IMAGE: Screenshot showing block execution controls -->
<!-- FILE: block-execution-controls.png -->
<!-- CAPTION: Block execution controls and shortcuts -->

### Running Multiple Blocks

**Run All Blocks:**
- Click "Run All" in toolbar
- Or Ctrl/Cmd + Shift + Enter
- All blocks execute sequentially

**Run Above:**
- Right-click block → "Run Above"
- Or Ctrl/Cmd + Shift + Up
- Executes all blocks above current

**Run Below:**
- Right-click block → "Run Below"
- Or Ctrl/Cmd + Shift + Down
- Executes all blocks below current

**Run Selected Blocks:**
1. Select multiple blocks (Shift + Click)
2. Click "Run Selected"
3. Or right-click → "Run Selected Cells"

<!-- IMAGE: Screenshot of Run All and other execution options -->
<!-- FILE: run-all-options.png -->
<!-- CAPTION: Multiple block execution options -->

### Execution Order

**Sequential Execution:**
- Blocks run in order from top to bottom
- Each block waits for previous to complete
- Execution count increments

**Execution Indicators:**
- `[*]` - Currently executing
- `[1]` - Execution count
- `[ ]` - Not yet executed

**Interrupt Execution:**
- Click "Interrupt" button
- Or press Ctrl/Cmd + C
- Stops current execution

<!-- IMAGE: Screenshot showing execution indicators -->
<!-- FILE: execution-indicators.png -->
<!-- CAPTION: Block execution status indicators -->

## Block Types and Execution

### Code Blocks

**Python Code:**
```python
import pandas as pd
import numpy as np

# Load data
df = pd.read_csv('/work/data/sales.csv')

# Basic analysis
print(f"Shape: {df.shape}")
print(f"Columns: {df.columns.tolist()}")

# Display
df.head()
```

**Execution:**
- Runs in Python kernel
- Outputs appear below block
- Variables stored in kernel memory

<!-- IMAGE: Screenshot of code block execution with output -->
<!-- FILE: code-block-execution.png -->
<!-- CAPTION: Code block execution with DataFrame output -->

### SQL Blocks

**SQL Query:**
```sql
SELECT 
    customer_id,
    SUM(amount) as total_spent,
    COUNT(*) as order_count,
    AVG(amount) as avg_order
FROM orders
WHERE order_date >= '2024-01-01'
GROUP BY customer_id
ORDER BY total_spent DESC
LIMIT 100
```

**Configuration:**
- Set integration in block metadata
- Assign to variable
- Choose return type (dataframe/query_preview)

**Execution:**
- Connects to database
- Executes query
- Returns results as DataFrame

<!-- IMAGE: Screenshot of SQL block execution -->
<!-- FILE: sql-block-execution.png -->
<!-- CAPTION: SQL block execution with results -->

### Input Blocks

**Interactive Inputs:**
- Text, textarea, checkbox
- Select, slider, file
- Date, date range

**Execution:**
- Generates variable assignment
- Updates when value changes
- Re-run dependent blocks

**Example:**
```python
# Input block generates:
date_range = ['2024-01-01', '2024-12-31']

# Use in code block:
df_filtered = df[
    (df['date'] >= date_range[0]) & 
    (df['date'] <= date_range[1])
]
```

<!-- IMAGE: Screenshot of input blocks with values -->
<!-- FILE: input-blocks-execution.png -->
<!-- CAPTION: Input blocks generating variables -->

### Markdown Blocks

**Rendered Markdown:**
- Headers, lists, links
- Code snippets
- Tables, images

**Execution:**
- Renders immediately
- No kernel execution needed
- Updates on edit

<!-- IMAGE: Screenshot of rendered markdown block -->
<!-- FILE: markdown-block-rendered.png -->
<!-- CAPTION: Rendered markdown block -->

## Output Management

### Viewing Outputs

**Output Types:**

**Text Output:**
```
Shape: (1000, 5)
Columns: ['id', 'name', 'date', 'amount', 'category']
```

**DataFrame Output:**
- Interactive table
- Sortable columns
- Scrollable rows
- Copy/export options

**Plot Output:**
- Rendered visualizations
- Interactive (plotly)
- Static (matplotlib)

**Error Output:**
- Formatted tracebacks
- Syntax highlighting
- Clickable file paths

<!-- IMAGE: Screenshot showing different output types -->
<!-- FILE: output-types-display.png -->
<!-- CAPTION: Various output types displayed -->

### Output Controls

**Collapse/Expand:**
- Click arrow next to output
- Hides/shows output panel
- Saves screen space

**Scroll Output:**
- Long outputs are scrollable
- Set max height in settings
- Prevents page overflow

**Clear Output:**
- Click "Clear" button
- Or right-click → "Clear Output"
- Removes output, keeps code

**Clear All Outputs:**
- Command Palette → "Deepnote: Clear All Outputs"
- Clears all notebook outputs
- Useful before committing

<!-- IMAGE: Screenshot of output controls -->
<!-- FILE: output-controls.png -->
<!-- CAPTION: Output panel controls -->

### Copying Outputs

**Copy as Text:**
1. Right-click output
2. Select "Copy Output"
3. Paste anywhere

**Export DataFrame:**
```python
# Save to CSV
df.to_csv('/work/outputs/results.csv', index=False)

# Save to Excel
df.to_excel('/work/outputs/results.xlsx', index=False)
```

**Save Plot:**
```python
import matplotlib.pyplot as plt

plt.savefig('/work/outputs/plot.png', dpi=300, bbox_inches='tight')
```

## Variables and State

### Variable Explorer

**View Variables:**
1. Click "Variables" in toolbar
2. Or Command Palette → "Deepnote: Show Variables"
3. Panel shows all variables

**Variable Information:**
- Name
- Type
- Value (for simple types)
- Size (for arrays/DataFrames)

<!-- IMAGE: Screenshot of Variable Explorer -->
<!-- FILE: variable-explorer-panel.png -->
<!-- CAPTION: Variable Explorer showing notebook variables -->

### Inspecting Variables

**In Code:**
```python
# Check variable type
print(type(df))

# Check DataFrame info
print(df.info())

# Check shape
print(df.shape)

# View first rows
df.head()
```

**Hover Inspection:**
- Hover over variable name
- Tooltip shows type and value
- Works with IntelliSense

**Debug Console:**
- Open during debugging
- Evaluate expressions
- Inspect variables

### Managing State

**Clear Variables:**
```python
# Delete specific variable
del df

# Clear all variables
%reset -f  # IPython magic
```

**Restart Kernel:**
- Clears all variables
- Fresh Python session
- Use when state is corrupted

**Persistent State:**
```python
# Save state
import pickle

with open('/work/state.pkl', 'wb') as f:
    pickle.dump({'df': df, 'model': model}, f)

# Load state
with open('/work/state.pkl', 'rb') as f:
    state = pickle.load(f)
    df = state['df']
    model = state['model']
```

## Debugging

### Setting Breakpoints

**Add Breakpoint:**
1. Click left margin next to line number
2. Red dot appears
3. Execution pauses at breakpoint

**Conditional Breakpoint:**
1. Right-click margin
2. Select "Add Conditional Breakpoint"
3. Enter condition: `x > 100`

**Logpoint:**
1. Right-click margin
2. Select "Add Logpoint"
3. Enter message: `Value is {x}`

<!-- IMAGE: Screenshot of breakpoint in code -->
<!-- FILE: breakpoint-example.png -->
<!-- CAPTION: Setting a breakpoint in a code block -->

### Debug Mode

**Start Debugging:**
1. Set breakpoints
2. Click "Debug Cell" button
3. Or press F5

**Debug Controls:**
- **Continue** (F5) - Run to next breakpoint
- **Step Over** (F10) - Execute current line
- **Step Into** (F11) - Enter function
- **Step Out** (Shift + F11) - Exit function
- **Stop** (Shift + F5) - End debugging

<!-- IMAGE: Screenshot of debug controls -->
<!-- FILE: debug-controls-toolbar.png -->
<!-- CAPTION: Debug toolbar with controls -->

### Debug Panels

**Variables Panel:**
- Shows all variables in scope
- Expand to see nested values
- Modify values during debugging

**Watch Panel:**
- Add expressions to watch
- Updates as you step through
- Monitor specific values

**Call Stack:**
- Shows function call hierarchy
- Click to jump to frame
- Inspect variables at each level

**Breakpoints Panel:**
- List all breakpoints
- Enable/disable breakpoints
- Edit conditions

<!-- IMAGE: Screenshot of debug panels -->
<!-- FILE: debug-panels-layout.png -->
<!-- CAPTION: Debug panels showing variables and call stack -->

### Debug Console

**Evaluate Expressions:**
```python
# In debug console
>>> df.shape
(1000, 5)

>>> df['amount'].sum()
125000.50

>>> len(df[df['amount'] > 100])
450
```

**Modify Variables:**
```python
# Change variable value
>>> x = 999

# Test conditions
>>> x > 100
True
```

## Error Handling

### Understanding Errors

**Common Error Types:**

**SyntaxError:**
```python
# Missing colon
if x > 10
    print(x)
```
**Fix:** Add colon after condition

**NameError:**
```python
# Variable not defined
print(undefined_variable)
```
**Fix:** Define variable first

**ImportError:**
```python
# Package not installed
import missing_package
```
**Fix:** `pip install missing_package`

**KeyError:**
```python
# Column doesn't exist
df['nonexistent_column']
```
**Fix:** Check column names

<!-- IMAGE: Screenshot of error traceback -->
<!-- FILE: error-traceback-display.png -->
<!-- CAPTION: Error traceback with highlighted issue -->

### Debugging Errors

**Read Traceback:**
1. Start from bottom (actual error)
2. Work up to find cause
3. Click file paths to jump to code

**Common Debugging Steps:**
```python
# 1. Check variable exists
print('df' in dir())

# 2. Check type
print(type(df))

# 3. Check value
print(df)

# 4. Check shape/length
print(df.shape if hasattr(df, 'shape') else len(df))
```

**Use Try-Except:**
```python
try:
    result = risky_operation()
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
```

### Error Recovery

**Restart Kernel:**
- Fixes import errors
- Clears corrupted state
- Fresh start

**Reload Modules:**
```python
import importlib
importlib.reload(my_module)
```

**Check Environment:**
```python
# Verify packages
!pip list | grep pandas

# Check Python version
import sys
print(sys.version)

# Check working directory
import os
print(os.getcwd())
```

## Performance Optimization

### Execution Speed

**Profile Code:**
```python
import time

start = time.time()
# Your code here
result = expensive_operation()
end = time.time()

print(f"Execution time: {end - start:.2f} seconds")
```

**Use %%time Magic:**
```python
%%time
# Cell execution time
df_processed = process_large_dataframe(df)
```

**Memory Profiling:**
```python
import psutil
import os

process = psutil.Process(os.getpid())
print(f"Memory: {process.memory_info().rss / 1024 / 1024:.2f} MB")
```

### Optimize DataFrame Operations

**Vectorization:**
```python
# Slow - iterating
for i, row in df.iterrows():
    df.at[i, 'new_col'] = row['col1'] * 2

# Fast - vectorized
df['new_col'] = df['col1'] * 2
```

**Efficient Filtering:**
```python
# Use boolean indexing
df_filtered = df[df['amount'] > 100]

# Chain conditions
df_filtered = df[(df['amount'] > 100) & (df['status'] == 'active')]
```

**Data Types:**
```python
# Optimize data types
df['id'] = df['id'].astype('int32')  # Instead of int64
df['category'] = df['category'].astype('category')  # For repeated values
```

### Memory Management

**Delete Unused Variables:**
```python
# Free memory
del large_dataframe
import gc
gc.collect()
```

**Process in Chunks:**
```python
# Read large file in chunks
chunk_size = 10000
for chunk in pd.read_csv('large_file.csv', chunksize=chunk_size):
    process_chunk(chunk)
```

**Use Generators:**
```python
# Memory-efficient iteration
def process_rows(df):
    for row in df.itertuples():
        yield process_row(row)

results = list(process_rows(df))
```

## Advanced Execution

### Execution Modes

**Block Mode:**
- Execute blocks independently
- No automatic dependencies
- Manual execution order

**Downstream Mode:**
- Execute dependent blocks automatically
- Tracks variable dependencies
- Cascading execution

<!-- IMAGE: Screenshot of execution mode selector -->
<!-- FILE: execution-mode-selector.png -->
<!-- CAPTION: Selecting execution mode -->

### Parallel Execution

**Run Multiple Notebooks:**
```python
import subprocess
from concurrent.futures import ThreadPoolExecutor

notebooks = [
    'notebook1.deepnote',
    'notebook2.deepnote',
    'notebook3.deepnote'
]

def run_notebook(notebook):
    subprocess.run(['deepnote-cli', 'run', notebook])

with ThreadPoolExecutor(max_workers=3) as executor:
    executor.map(run_notebook, notebooks)
```

### Scheduled Execution

**Using Cron (Linux/macOS):**
```bash
# Edit crontab
crontab -e

# Run daily at 2 AM
0 2 * * * cd /path/to/project && /path/to/.venv/bin/python -m deepnote run notebook.deepnote
```

**Using Task Scheduler (Windows):**
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (daily, weekly)
4. Action: Start program
5. Program: `python`
6. Arguments: `-m deepnote run notebook.deepnote`

### Batch Processing

**Process Multiple Files:**
```python
import glob

# Get all CSV files
files = glob.glob('/work/data/*.csv')

# Process each
results = []
for file in files:
    df = pd.read_csv(file)
    result = process_dataframe(df)
    results.append(result)

# Combine results
final_df = pd.concat(results, ignore_index=True)
```

## Keyboard Shortcuts Reference

### Essential Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Run cell | Shift + Enter | Shift + Return |
| Run and insert | Alt + Enter | Option + Return |
| Run all | Ctrl + Shift + Enter | Cmd + Shift + Return |
| Interrupt | Ctrl + C | Cmd + C |
| Restart kernel | Ctrl + Shift + R | Cmd + Shift + R |

### Navigation

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Next cell | Down | Down |
| Previous cell | Up | Up |
| First cell | Ctrl + Home | Cmd + Home |
| Last cell | Ctrl + End | Cmd + End |

### Editing

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Insert above | Ctrl + Shift + A | Cmd + Shift + A |
| Insert below | Ctrl + Shift + B | Cmd + Shift + B |
| Delete cell | Ctrl + Shift + D | Cmd + Shift + D |
| Copy cell | Ctrl + C | Cmd + C |
| Paste cell | Ctrl + V | Cmd + V |

### Debugging

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Toggle breakpoint | F9 | F9 |
| Start debugging | F5 | F5 |
| Step over | F10 | F10 |
| Step into | F11 | F11 |
| Stop debugging | Shift + F5 | Shift + F5 |

<!-- IMAGE: Screenshot of keyboard shortcuts cheat sheet -->
<!-- FILE: keyboard-shortcuts-reference.png -->
<!-- CAPTION: Complete keyboard shortcuts reference -->

## Best Practices

### Execution Workflow

1. **Start Fresh:**
   - Restart kernel
   - Run all blocks
   - Verify outputs

2. **Incremental Development:**
   - Write small blocks
   - Test frequently
   - Build progressively

3. **Error Handling:**
   - Add try-except blocks
   - Validate inputs
   - Log errors

4. **Documentation:**
   - Add markdown explanations
   - Comment complex code
   - Document assumptions

### Code Organization

**Logical Grouping:**
```python
# === Data Loading ===
df = pd.read_csv('data.csv')

# === Data Cleaning ===
df = df.dropna()
df = df[df['amount'] > 0]

# === Analysis ===
summary = df.groupby('category').agg({
    'amount': ['sum', 'mean', 'count']
})

# === Visualization ===
import matplotlib.pyplot as plt
plt.figure(figsize=(10, 6))
summary.plot(kind='bar')
plt.show()
```

### Performance Tips

- ✅ Use vectorized operations
- ✅ Avoid loops when possible
- ✅ Process data in chunks
- ✅ Clear unused variables
- ✅ Use appropriate data types
- ✅ Profile slow operations

### Debugging Tips

- ✅ Start with simple test cases
- ✅ Use print statements liberally
- ✅ Check intermediate results
- ✅ Use debugger for complex issues
- ✅ Read error messages carefully
- ✅ Search for error messages online

## Troubleshooting

### Common Issues

**Issue: Kernel Won't Start**
- Check Python interpreter is selected
- Verify virtual environment is activated
- Check for package conflicts
- Try restarting VS Code

**Issue: Blocks Won't Execute**
- Check kernel status (should be "Idle")
- Verify no syntax errors
- Check for infinite loops
- Try interrupting and restarting

**Issue: Slow Execution**
- Check data size
- Profile code to find bottlenecks
- Optimize DataFrame operations
- Consider using chunks

**Issue: Out of Memory**
- Reduce data size
- Process in chunks
- Delete unused variables
- Restart kernel

**Issue: Import Errors**
- Verify package is installed: `pip list`
- Check virtual environment is activated
- Install missing package: `pip install package`
- Restart kernel after installing

## Related Documentation

- [Deepnote VS Code Extension](./vscode-extension.md) - Extension features
- [Deepnote Projects in VS Code](./vscode-projects.md) - Project management
- [VS Code Supported Blocks](./vscode-supported-blocks.md) - Block types
- [Reading .deepnote Files](./reading-deepnote-files.md) - File format

## Conclusion

Running Deepnote notebooks in VS Code provides a powerful local development environment with full execution, debugging, and optimization capabilities. Master these techniques to work efficiently with your notebooks.

**Happy executing! ⚡**
