---
title: Moving from Jupyter to Deepnote
description: Complete migration guide for Jupyter users switching to Deepnote, including feature comparisons, conversion steps, and best practices.
noIndex: false
noContent: false
---

# Moving from Jupyter to Deepnote

This guide helps Jupyter users transition to Deepnote, highlighting key differences, advantages, and providing step-by-step migration instructions.

## Why Move from Jupyter to Deepnote?

### What You Gain

**Collaboration:**
- ✅ Real-time collaborative editing (like Google Docs)
- ✅ Comments and discussions on blocks
- ✅ Team workspaces and permissions
- ❌ Jupyter: Single-user, file-based collaboration

**Version Control:**
- ✅ Built-in version history
- ✅ Git-friendly YAML format
- ✅ Clean, readable diffs
- ❌ Jupyter: JSON format with noisy diffs

**Infrastructure:**
- ✅ Managed compute resources
- ✅ Scalable hardware (CPU/GPU)
- ✅ No local setup required
- ❌ Jupyter: Local resources only

**Data Connections:**
- ✅ One-click database integrations
- ✅ Built-in SQL blocks
- ✅ Secure credential management
- ❌ Jupyter: Manual connection setup

**Advanced Features:**
- ✅ Interactive input blocks
- ✅ Scheduled notebook runs
- ✅ Publishing and sharing
- ✅ Interactive apps
- ❌ Jupyter: Limited interactivity

<!-- IMAGE: Side-by-side comparison of Jupyter vs Deepnote interface -->
<!-- FILE: jupyter-vs-deepnote-interface.png -->
<!-- CAPTION: Jupyter Notebook vs Deepnote interface comparison -->

### What You Keep

**Familiar Concepts:**
- ✅ Cell-based editing
- ✅ Python kernel
- ✅ Rich outputs (plots, DataFrames)
- ✅ Markdown support
- ✅ Magic commands
- ✅ Keyboard shortcuts (similar)

**Compatibility:**
- ✅ Import `.ipynb` files directly
- ✅ Export to `.ipynb` format
- ✅ Same Python packages
- ✅ Same data science libraries

## Feature Comparison

### Core Features

| Feature | Jupyter Notebook | Deepnote |
|---------|-----------------|----------|
| **File Format** | JSON (`.ipynb`) | YAML (`.deepnote`) |
| **Collaboration** | File-based | Real-time |
| **Version Control** | Noisy diffs | Clean diffs |
| **Compute** | Local only | Local + Cloud |
| **Database Access** | Manual setup | Built-in integrations |
| **Scheduling** | External tools | Built-in |
| **Publishing** | nbviewer, GitHub | Native sharing |
| **Interactive Inputs** | Widgets | Native input blocks |

### Cell Types

| Jupyter | Deepnote | Notes |
|---------|----------|-------|
| Code cell | Code block | ✅ Same functionality |
| Markdown cell | Text blocks | ✅ Enhanced formatting |
| Raw cell | - | ⚠️ Not supported |
| - | SQL block | ✅ New: Native SQL |
| - | Input blocks | ✅ New: Interactive params |
| - | Visualization block | ✅ New: Chart builder |
| - | Big number block | ✅ New: KPI display |

### Execution

| Feature | Jupyter | Deepnote |
|---------|---------|----------|
| **Run cell** | Shift + Enter | Shift + Enter |
| **Run all** | Cell → Run All | Ctrl/Cmd + Shift + Enter |
| **Execution order** | Manual | Manual or Downstream |
| **Kernel restart** | Kernel → Restart | Restart button |
| **Interrupt** | Kernel → Interrupt | Interrupt button |
| **Execution count** | `[1]` | `[1]` |

### Output Display

| Output Type | Jupyter | Deepnote |
|-------------|---------|----------|
| Text | ✅ | ✅ |
| DataFrames | ✅ Basic | ✅ Interactive |
| Plots | ✅ | ✅ |
| HTML | ✅ | ✅ |
| Images | ✅ | ✅ |
| Widgets | ✅ ipywidgets | ✅ Native inputs |
| Tables | ✅ Basic | ✅ Sortable/filterable |

<!-- IMAGE: Comparison of DataFrame display in Jupyter vs Deepnote -->
<!-- FILE: dataframe-comparison.png -->
<!-- CAPTION: DataFrame display: Jupyter (left) vs Deepnote (right) -->

## Migration Process

### Step 1: Export from Jupyter

**Option A: Export Single Notebook**
```bash
# Your notebook is already in .ipynb format
# No export needed - just use the file
```

**Option B: Export from JupyterLab**
1. File → Export Notebook As → Executable Script (optional)
2. Or just use the `.ipynb` file directly

**Option C: Clean Outputs Before Export**
```bash
# Remove outputs to reduce file size
jupyter nbconvert --clear-output --inplace notebook.ipynb
```

### Step 2: Convert to Deepnote Format

**Method 1: Direct Import (Recommended)**

Upload `.ipynb` directly to Deepnote - it converts automatically.

**Method 2: Command Line Conversion**
```bash
# Install converter
npm install -g @deepnote/convert

# Convert notebook
deepnote-convert notebook.ipynb -o notebook.deepnote

# Convert multiple notebooks
deepnote-convert notebooks/*.ipynb --projectName "My Project"

# Specify output directory
deepnote-convert notebook.ipynb -o output/notebook.deepnote
```

**Method 3: Python Script**
```python
from deepnote_convert import convert_notebook

# Convert single file
convert_notebook('notebook.ipynb', 'notebook.deepnote')

# Convert with options
convert_notebook(
    'notebook.ipynb',
    'notebook.deepnote',
    project_name='My Project',
    clear_outputs=True
)
```

<!-- IMAGE: Screenshot of conversion process -->
<!-- FILE: conversion-process.png -->
<!-- CAPTION: Converting Jupyter notebook to Deepnote format -->

### Step 3: Upload to Deepnote

**Upload to Deepnote Cloud:**

1. **Log in to Deepnote**
   - Go to [deepnote.com](https://deepnote.com)
   - Sign in or create account

2. **Create New Project**
   - Click "New project"
   - Choose "Upload .ipynb file" or "Upload .deepnote file"

3. **Select File**
   - Browse to your file
   - Click "Upload"

4. **Review Import**
   - Check all cells imported correctly
   - Verify outputs (if included)
   - Review any warnings

<!-- IMAGE: Screenshot of upload dialog in Deepnote -->
<!-- FILE: deepnote-upload-dialog.png -->
<!-- CAPTION: Uploading notebook to Deepnote Cloud -->

**Or Open Locally in VS Code:**

1. **Install Deepnote Extension**
   - Open VS Code
   - Install "Deepnote" extension

2. **Open File**
   - File → Open
   - Select `.deepnote` file

3. **Select Python Interpreter**
   - Choose your Python environment

### Step 4: Update Dependencies

**Check Requirements:**
```python
# In first cell
!pip list
```

**Add Missing Packages:**

In Deepnote Cloud:
1. Go to Environment settings
2. Add packages to requirements

In VS Code:
```bash
pip install package-name
```

**Common Packages:**
```txt
pandas>=2.0.0
numpy>=1.24.0
matplotlib>=3.7.0
seaborn>=0.12.0
scikit-learn>=1.3.0
```

### Step 5: Adapt Code

**File Paths:**
```python
# Jupyter (local paths)
df = pd.read_csv('data/sales.csv')
df = pd.read_csv('/Users/username/data/sales.csv')

# Deepnote (use /work directory)
df = pd.read_csv('/work/data/sales.csv')
```

**Database Connections:**
```python
# Jupyter (manual connection)
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    database="mydb",
    user="user",
    password="pass"
)

# Deepnote (use SQL blocks)
# Create SQL block instead:
# SELECT * FROM table
# Deepnote handles connection automatically
```

**Widgets:**
```python
# Jupyter (ipywidgets)
import ipywidgets as widgets
slider = widgets.IntSlider(min=0, max=100, value=50)
display(slider)

# Deepnote (use input blocks)
# Create input-slider block instead
# It generates: threshold = 50
```

## Key Differences to Know

### 1. File Format

**Jupyter (JSON):**
```json
{
  "cells": [
    {
      "cell_type": "code",
      "execution_count": 1,
      "metadata": {},
      "outputs": [],
      "source": ["print('hello')"]
    }
  ]
}
```

**Deepnote (YAML):**
```yaml
blocks:
  - id: 'block-001'
    type: code
    executionCount: 1
    content: |
      print('hello')
    metadata: {}
```

**Advantages:**
- ✅ Human-readable
- ✅ Clean git diffs
- ✅ Easy to edit manually
- ✅ Better for version control

<!-- IMAGE: Git diff comparison showing Jupyter vs Deepnote -->
<!-- FILE: git-diff-comparison.png -->
<!-- CAPTION: Git diff: Jupyter (noisy) vs Deepnote (clean) -->

### 2. Execution Modes

**Jupyter:**
- Only sequential execution
- Manual cell execution
- No dependency tracking

**Deepnote:**
- **Block mode** - Like Jupyter (manual)
- **Downstream mode** - Auto-execute dependent blocks
- Dependency tracking

**Example:**
```python
# Block 1
x = 10

# Block 2 (depends on Block 1)
y = x * 2

# Block 3 (depends on Block 2)
z = y + 5

# In Downstream mode:
# Changing Block 1 automatically re-runs Blocks 2 and 3
```

### 3. Collaboration

**Jupyter:**
- One person edits at a time
- Share via file or GitHub
- Merge conflicts common
- No real-time updates

**Deepnote:**
- Multiple people edit simultaneously
- See others' cursors and changes
- Comments and discussions
- Real-time synchronization

<!-- IMAGE: Screenshot showing multiple users editing in Deepnote -->
<!-- FILE: realtime-collaboration.png -->
<!-- CAPTION: Real-time collaboration in Deepnote -->

### 4. Database Access

**Jupyter:**
```python
# Manual connection setup
import psycopg2
import pandas as pd

conn = psycopg2.connect(
    host="db.example.com",
    database="analytics",
    user="analyst",
    password="secret"
)

query = "SELECT * FROM sales"
df = pd.read_sql(query, conn)
conn.close()
```

**Deepnote:**
```sql
-- SQL block with integration
SELECT * FROM sales
```
- No connection code needed
- Credentials managed securely
- Results assigned to variable automatically

### 5. Interactive Inputs

**Jupyter (ipywidgets):**
```python
import ipywidgets as widgets
from IPython.display import display

# Create widget
date_picker = widgets.DatePicker(
    description='Start Date',
    value=datetime.date(2024, 1, 1)
)

# Display
display(date_picker)

# Use value
start_date = date_picker.value
```

**Deepnote (Input Blocks):**
- Create input-date block
- Set variable name: `start_date`
- Set default value
- Variable automatically available
- No code needed

<!-- IMAGE: Comparison of widgets in Jupyter vs input blocks in Deepnote -->
<!-- FILE: widgets-vs-inputs.png -->
<!-- CAPTION: Jupyter widgets vs Deepnote input blocks -->

## Common Migration Scenarios

### Scenario 1: Data Analysis Notebook

**Jupyter Workflow:**
1. Load data from CSV
2. Clean and process
3. Analyze and visualize
4. Export results

**Deepnote Migration:**
```python
# Block 1: Load data (same as Jupyter)
import pandas as pd
df = pd.read_csv('/work/data/sales.csv')

# Block 2: Add input for date range
# Create input-date-range block
# Variable: date_range
# Value: past7days

# Block 3: Filter data (use input)
df_filtered = df[
    (df['date'] >= date_range[0]) & 
    (df['date'] <= date_range[1])
]

# Block 4: Analysis (same as Jupyter)
summary = df_filtered.groupby('category').agg({
    'amount': ['sum', 'mean', 'count']
})

# Block 5: Visualization (same as Jupyter)
import matplotlib.pyplot as plt
summary.plot(kind='bar')
plt.show()
```

**Improvements:**
- ✅ Interactive date range selection
- ✅ Easy to share with team
- ✅ Can schedule to run daily
- ✅ Publish as interactive app

### Scenario 2: SQL + Python Notebook

**Jupyter Approach:**
```python
# Cell 1: Setup connection
import psycopg2
import pandas as pd

conn = psycopg2.connect(...)

# Cell 2: Query data
query = """
SELECT customer_id, SUM(amount) as total
FROM orders
GROUP BY customer_id
"""
df = pd.read_sql(query, conn)

# Cell 3: Python analysis
top_customers = df.nlargest(10, 'total')
```

**Deepnote Approach:**
```sql
-- SQL Block: Query data
-- Variable: df
-- Integration: postgres-prod
SELECT customer_id, SUM(amount) as total
FROM orders
GROUP BY customer_id
```

```python
# Code Block: Python analysis
top_customers = df.nlargest(10, 'total')
```

**Improvements:**
- ✅ No connection code needed
- ✅ SQL syntax highlighting
- ✅ Secure credential management
- ✅ Cleaner separation of SQL and Python

### Scenario 3: Machine Learning Pipeline

**Jupyter Workflow:**
```python
# Load data
df = pd.read_csv('data.csv')

# Preprocess
X = df.drop('target', axis=1)
y = df['target']

# Train model
from sklearn.ensemble import RandomForestClassifier
model = RandomForestClassifier()
model.fit(X, y)

# Evaluate
from sklearn.metrics import accuracy_score
predictions = model.predict(X)
accuracy = accuracy_score(y, predictions)
print(f"Accuracy: {accuracy}")
```

**Deepnote Migration:**
- Same code works!
- Add input blocks for hyperparameters
- Use downstream mode for automatic re-training
- Schedule for regular retraining
- Share results with team

```python
# Block 1: Input for hyperparameters
# Create input-slider blocks:
# - n_estimators (10-200, default 100)
# - max_depth (1-50, default 10)

# Block 2: Train model (uses inputs)
model = RandomForestClassifier(
    n_estimators=n_estimators,
    max_depth=max_depth
)
model.fit(X, y)

# Block 3: Evaluate (auto-reruns when inputs change)
predictions = model.predict(X)
accuracy = accuracy_score(y, predictions)
print(f"Accuracy: {accuracy}")
```

## Troubleshooting Migration Issues

### Issue 1: Import Errors

**Problem:** Packages not found after migration

**Solution:**
```python
# Check installed packages
!pip list

# Install missing packages
!pip install package-name

# Or add to requirements.txt (Deepnote Cloud)
```

### Issue 2: File Paths Don't Work

**Problem:** `FileNotFoundError`

**Solution:**
```python
# Jupyter paths
'data/file.csv'  # Relative to notebook
'/Users/me/data/file.csv'  # Absolute local path

# Deepnote paths
'/work/data/file.csv'  # Use /work directory

# Check current directory
import os
print(os.getcwd())  # Should be /work

# List files
!ls /work/data/
```

### Issue 3: Widgets Don't Work

**Problem:** ipywidgets not displaying

**Solution:**
Replace with Deepnote input blocks:

```python
# Instead of:
slider = widgets.IntSlider(min=0, max=100, value=50)

# Create input-slider block with:
# - Variable name: slider_value
# - Min: 0, Max: 100, Default: 50

# Then use:
value = slider_value
```

### Issue 4: Database Connections Fail

**Problem:** Connection errors

**Solution:**
```python
# Instead of manual connection:
# conn = psycopg2.connect(...)

# Use SQL blocks with integrations:
# 1. Add database integration in Deepnote
# 2. Create SQL block
# 3. Select integration
# 4. Write query
```

### Issue 5: Magic Commands

**Problem:** Some magic commands don't work

**Solution:**

**Supported:**
```python
%matplotlib inline  # ✅ Works
%time  # ✅ Works
%%time  # ✅ Works
%load_ext  # ✅ Works
```

**Not Supported:**
```python
%load  # ⚠️ Use import instead
%run  # ⚠️ Use import or copy code
```

## Best Practices for Migration

### 1. Start with Simple Notebooks

- Migrate simple notebooks first
- Test thoroughly
- Learn Deepnote features
- Then migrate complex notebooks

### 2. Clean Up Before Migration

```python
# Remove outputs
jupyter nbconvert --clear-output --inplace notebook.ipynb

# Remove unused cells
# Delete debugging code
# Clean up imports
```

### 3. Organize Your Project

```
project/
├── notebooks/
│   ├── 01_data_loading.deepnote
│   ├── 02_analysis.deepnote
│   └── 03_visualization.deepnote
├── data/
├── outputs/
└── requirements.txt
```

### 4. Use Deepnote Features

**Replace widgets with input blocks:**
- More reliable
- Better performance
- Easier to use

**Use SQL blocks for databases:**
- Cleaner code
- Secure credentials
- Better syntax highlighting

**Add markdown documentation:**
- Explain your analysis
- Document assumptions
- Add usage instructions

### 5. Test Thoroughly

**Checklist:**
- [ ] All cells execute without errors
- [ ] Outputs match Jupyter outputs
- [ ] File paths work correctly
- [ ] Database connections work
- [ ] Plots display correctly
- [ ] Interactive elements work
- [ ] Dependencies are documented

## Feature Mapping Guide

### Jupyter Features → Deepnote Equivalents

| Jupyter Feature | Deepnote Equivalent |
|----------------|---------------------|
| Code cell | Code block |
| Markdown cell | Text blocks (h1, h2, h3, p, etc.) |
| Raw cell | Not supported (use code block) |
| Cell output | Block output |
| Kernel restart | Restart kernel button |
| Run all cells | Run all blocks |
| ipywidgets | Input blocks |
| `%matplotlib inline` | Automatic |
| nbextensions | Native features |
| JupyterLab extensions | Native features |
| nbviewer | Native sharing |
| Voilà dashboards | Deepnote apps |

### Keyboard Shortcuts

| Action | Jupyter | Deepnote |
|--------|---------|----------|
| Run cell | Shift + Enter | Shift + Enter |
| Run and insert | Alt + Enter | Alt + Enter |
| Insert above | A | Ctrl/Cmd + Shift + A |
| Insert below | B | Ctrl/Cmd + Shift + B |
| Delete cell | DD | Ctrl/Cmd + Shift + D |
| Change to code | Y | (Select from dropdown) |
| Change to markdown | M | (Select from dropdown) |
| Command mode | Esc | Esc |
| Edit mode | Enter | Enter |

<!-- IMAGE: Keyboard shortcuts comparison chart -->
<!-- FILE: keyboard-shortcuts-comparison.png -->
<!-- CAPTION: Jupyter vs Deepnote keyboard shortcuts -->

## Advanced Migration Topics

### Migrating JupyterLab Extensions

**Common Extensions:**

| JupyterLab Extension | Deepnote Alternative |
|---------------------|---------------------|
| jupyterlab-git | Native Git integration |
| jupyterlab-toc | Automatic outline |
| jupyterlab-execute-time | Execution time display |
| jupyterlab-variableinspector | Variable explorer |
| jupyterlab-spreadsheet | Interactive DataFrames |

### Migrating Custom Kernels

**Python Kernels:**
- Deepnote uses standard Python kernel
- Install packages in environment
- Same as Jupyter

**Other Kernels (R, Julia):**
- Currently not supported in Deepnote
- Use Python alternatives
- Or keep using Jupyter for these

### Migrating nbextensions

**Popular Extensions:**

| nbextension | Deepnote Alternative |
|------------|---------------------|
| Table of Contents | Native outline |
| Collapsible Headings | Native collapsing |
| ExecuteTime | Native execution time |
| Codefolding | Native code folding |
| Variable Inspector | Variable explorer |

## Migration Checklist

### Pre-Migration

- [ ] List all notebooks to migrate
- [ ] Document dependencies
- [ ] Note any custom extensions used
- [ ] Identify database connections
- [ ] Check for local file dependencies
- [ ] Review widget usage

### During Migration

- [ ] Convert notebooks to .deepnote format
- [ ] Upload to Deepnote
- [ ] Set up Python environment
- [ ] Add required packages
- [ ] Configure database integrations
- [ ] Upload data files
- [ ] Update file paths
- [ ] Replace widgets with input blocks
- [ ] Test execution

### Post-Migration

- [ ] Verify all outputs
- [ ] Test interactivity
- [ ] Share with team
- [ ] Set up schedules (if needed)
- [ ] Configure Git integration
- [ ] Document changes
- [ ] Archive Jupyter notebooks

## Getting Help

### Resources

- **Documentation:** [docs.deepnote.com](https://docs.deepnote.com)
- **Community:** [community.deepnote.com](https://community.deepnote.com)
- **Support:** support@deepnote.com
- **Migration Tool:** `@deepnote/convert` package

### Common Questions

**Q: Can I still use Jupyter after migrating?**
A: Yes! You can export from Deepnote back to `.ipynb` format anytime.

**Q: Will my Jupyter notebooks still work?**
A: Yes, they remain unchanged. Deepnote creates a copy.

**Q: Do I need to learn a new syntax?**
A: No, Python code is exactly the same.

**Q: What about my data files?**
A: Upload them to Deepnote or connect to cloud storage.

**Q: Can I collaborate on Jupyter notebooks?**
A: Not in real-time. Deepnote enables real-time collaboration.

## Next Steps

After migrating:

1. **Explore Deepnote Features**
   - Try SQL blocks
   - Use input blocks
   - Enable downstream mode
   - Schedule notebook runs

2. **Invite Your Team**
   - Share projects
   - Collaborate in real-time
   - Add comments and discussions

3. **Optimize Your Workflow**
   - Use database integrations
   - Create interactive apps
   - Set up automated runs

4. **Learn Advanced Features**
   - Version history
   - Publishing
   - API access
   - Custom environments

## Related Documentation

- [Deepnote Format](./deepnote-format.md) - File format details
- [Supported Code Blocks](./supported-code-blocks.md) - Block types
- [Migrating to Cloud](./migrating-to-cloud.md) - Cloud migration
- [VS Code Extension](./vscode-extension.md) - Local development

## Conclusion

Migrating from Jupyter to Deepnote is straightforward and brings significant benefits in collaboration, infrastructure, and advanced features. Your Python skills and notebooks transfer directly, while you gain powerful new capabilities.

**Welcome to Deepnote! 🚀**
