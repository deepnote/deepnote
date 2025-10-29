---
title: Moving from VS Code Jupyter to Deepnote
description: Migration guide for VS Code Jupyter users switching to Deepnote, including feature comparisons and workflow adaptations.
noIndex: false
noContent: false
---

# Moving from VS Code Jupyter to Deepnote

This guide helps VS Code Jupyter users transition to Deepnote, highlighting key differences, advantages, and providing practical migration steps.

## VS Code Jupyter vs Deepnote

### What You Know from VS Code Jupyter

If you're using Jupyter in VS Code, you're already familiar with:
- ✅ Notebook-based development
- ✅ Cell execution
- ✅ Rich outputs
- ✅ Markdown cells
- ✅ Variable explorer
- ✅ Debugging
- ✅ Git integration

**Good news:** Deepnote builds on these concepts while adding powerful collaboration and cloud features.

<!-- IMAGE: Side-by-side comparison of VS Code Jupyter vs Deepnote -->
<!-- FILE: vscode-jupyter-vs-deepnote.png -->
<!-- CAPTION: VS Code Jupyter vs Deepnote interface -->

### What Deepnote Adds

**Collaboration:**
- ✅ Real-time collaborative editing
- ✅ Multiple cursors visible
- ✅ Comments and discussions
- ✅ Team workspaces
- ❌ VS Code: Single-user editing

**Cloud Infrastructure:**
- ✅ Managed compute resources
- ✅ Scalable hardware
- ✅ No local setup
- ✅ Run from anywhere
- ❌ VS Code: Local resources only

**Data Integrations:**
- ✅ One-click database connections
- ✅ Native SQL blocks
- ✅ Secure credentials
- ✅ Built-in data sources
- ❌ VS Code: Manual setup

**Advanced Features:**
- ✅ Interactive input blocks
- ✅ Scheduled runs
- ✅ Publishing and sharing
- ✅ Interactive apps
- ❌ VS Code: Limited interactivity

### What Stays the Same

**Core Functionality:**
- ✅ Cell-based editing
- ✅ Python execution
- ✅ Rich outputs
- ✅ Markdown support
- ✅ Keyboard shortcuts (similar)
- ✅ Git integration
- ✅ Variable inspection
- ✅ Debugging

**File Compatibility:**
- ✅ Import `.ipynb` files
- ✅ Export to `.ipynb`
- ✅ Same Python packages
- ✅ Same libraries

## Feature Comparison

### Core Features

| Feature | VS Code Jupyter | Deepnote |
|---------|----------------|----------|
| **Environment** | Local | Local + Cloud |
| **Collaboration** | Git-based | Real-time |
| **File Format** | `.ipynb` (JSON) | `.deepnote` (YAML) |
| **Execution** | Local kernel | Local + Cloud kernel |
| **Database Access** | Manual | Built-in integrations |
| **Scheduling** | External | Built-in |
| **Sharing** | Export/GitHub | Native sharing |
| **Interactive Inputs** | ipywidgets | Native input blocks |
| **Version Control** | Git (noisy diffs) | Git (clean diffs) |

### Interface Comparison

**VS Code Jupyter:**
- Notebook in editor pane
- Variable explorer in sidebar
- Output below cells
- Terminal in panel
- Git in source control

**Deepnote:**
- Notebook in main area
- Variable explorer in toolbar
- Output inline with cells
- Terminal available
- Git integration built-in
- Comments sidebar

<!-- IMAGE: Labeled screenshot comparing VS Code and Deepnote interfaces -->
<!-- FILE: interface-comparison-labeled.png -->
<!-- CAPTION: Interface comparison with labeled features -->

### Cell Types

| VS Code Jupyter | Deepnote | Notes |
|----------------|----------|-------|
| Code cell | Code block | ✅ Same |
| Markdown cell | Text blocks | ✅ Enhanced |
| Raw cell | - | ⚠️ Not supported |
| - | SQL block | ✅ New |
| - | Input blocks | ✅ New |
| - | Visualization block | ✅ New |
| - | Big number block | ✅ New |

### Keyboard Shortcuts

| Action | VS Code Jupyter | Deepnote |
|--------|----------------|----------|
| Run cell | Shift + Enter | Shift + Enter |
| Run and insert | Alt + Enter | Alt + Enter |
| Run all | (Command Palette) | Ctrl/Cmd + Shift + Enter |
| Insert above | A (command mode) | Ctrl/Cmd + Shift + A |
| Insert below | B (command mode) | Ctrl/Cmd + Shift + B |
| Delete cell | DD (command mode) | Ctrl/Cmd + Shift + D |
| Change to code | Y (command mode) | (Dropdown) |
| Change to markdown | M (command mode) | (Dropdown) |
| Command mode | Esc | Esc |
| Edit mode | Enter | Enter |

<!-- IMAGE: Keyboard shortcuts comparison chart -->
<!-- FILE: keyboard-shortcuts-comparison.png -->
<!-- CAPTION: Keyboard shortcuts: VS Code Jupyter vs Deepnote -->

## Migration Process

### Step 1: Assess Your Notebooks

**Inventory:**
```bash
# Find all notebooks
find . -name "*.ipynb" -type f

# Count notebooks
find . -name "*.ipynb" | wc -l

# Check sizes
find . -name "*.ipynb" -exec ls -lh {} \;
```

**Categorize:**
- Personal analysis → Migrate to Deepnote Cloud
- Team projects → Migrate to Deepnote Cloud (collaboration)
- Local development → Keep in VS Code or migrate to Deepnote local

### Step 2: Export from VS Code

**Your notebooks are already in `.ipynb` format - no export needed!**

**Optional: Clean outputs:**
```bash
# Remove outputs to reduce size
jupyter nbconvert --clear-output --inplace notebook.ipynb

# Or use nbstripout
pip install nbstripout
nbstripout notebook.ipynb
```

### Step 3: Convert to Deepnote Format

**Option A: Direct Import (Easiest)**

Upload `.ipynb` to Deepnote - automatic conversion.

**Option B: Command Line Conversion**
```bash
# Install converter
npm install -g @deepnote/convert

# Convert single notebook
deepnote-convert notebook.ipynb -o notebook.deepnote

# Convert all notebooks in directory
deepnote-convert notebooks/*.ipynb --projectName "My Project"

# Batch convert with options
for file in notebooks/*.ipynb; do
  deepnote-convert "$file" -o "converted/$(basename $file .ipynb).deepnote"
done
```

**Option C: Keep Using .ipynb**

You can also use `.ipynb` files directly in Deepnote!

### Step 4: Choose Your Environment

**Option 1: Deepnote Cloud**
- Best for collaboration
- Managed infrastructure
- Built-in integrations
- Scheduled runs

**Option 2: Deepnote in VS Code**
- Install Deepnote extension
- Work locally with `.deepnote` files
- Use your local environment
- Sync with cloud when needed

**Option 3: Hybrid**
- Develop locally in VS Code
- Deploy to Deepnote Cloud for sharing
- Best of both worlds

<!-- IMAGE: Diagram showing three deployment options -->
<!-- FILE: deployment-options-diagram.png -->
<!-- CAPTION: Three ways to use Deepnote -->

### Step 5: Migrate to Cloud (if chosen)

**Upload to Deepnote Cloud:**

1. **Log in**
   - Go to [deepnote.com](https://deepnote.com)
   - Sign in or create account

2. **Create Project**
   - Click "New project"
   - Choose "Upload .ipynb file" or "Upload .deepnote file"

3. **Upload Files**
   - Select your notebook(s)
   - Wait for import

4. **Configure Environment**
   - Set Python version
   - Add packages
   - Set up integrations

<!-- IMAGE: Screenshot of upload process in Deepnote Cloud -->
<!-- FILE: cloud-upload-process.png -->
<!-- CAPTION: Uploading notebooks to Deepnote Cloud -->

### Step 6: Set Up Environment

**In VS Code Jupyter:**
```bash
# Your setup
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**In Deepnote Cloud:**
1. Go to Environment settings
2. Select Python version
3. Add packages from requirements.txt
4. Or paste requirements.txt content

**In Deepnote VS Code Extension:**
```bash
# Same as before
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install deepnote-toolkit  # Additional
```

### Step 7: Adapt Your Code

**File Paths:**
```python
# VS Code Jupyter (relative paths)
df = pd.read_csv('data/sales.csv')
df = pd.read_csv('../data/sales.csv')

# Deepnote Cloud (use /work)
df = pd.read_csv('/work/data/sales.csv')

# Deepnote VS Code Extension (relative paths work)
df = pd.read_csv('data/sales.csv')
```

**Database Connections:**
```python
# VS Code Jupyter (manual)
import psycopg2
conn = psycopg2.connect(
    host="localhost",
    database="mydb",
    user="user",
    password="pass"
)
df = pd.read_sql("SELECT * FROM table", conn)

# Deepnote (use SQL blocks)
# Create SQL block:
# SELECT * FROM table
# Integration: postgres-prod
# Variable: df
```

**Widgets:**
```python
# VS Code Jupyter (ipywidgets)
import ipywidgets as widgets
slider = widgets.IntSlider(min=0, max=100, value=50)
display(slider)

# Deepnote (input blocks)
# Create input-slider block
# Variable: slider_value
# Min: 0, Max: 100, Default: 50
```

## Workflow Adaptations

### Local Development Workflow

**VS Code Jupyter:**
```
1. Open VS Code
2. Open .ipynb file
3. Select Python interpreter
4. Run cells
5. Save file
6. Commit to Git
```

**Deepnote in VS Code:**
```
1. Open VS Code
2. Open .deepnote file
3. Select Python interpreter
4. Run blocks
5. Auto-saves
6. Commit to Git
```

**Key Differences:**
- `.deepnote` files are YAML (more readable)
- Auto-save by default
- Better Git diffs

<!-- IMAGE: Screenshot of .deepnote file in VS Code -->
<!-- FILE: deepnote-file-vscode.png -->
<!-- CAPTION: Working with .deepnote files in VS Code -->

### Cloud Collaboration Workflow

**VS Code Jupyter:**
```
1. Edit notebook locally
2. Save and commit
3. Push to Git
4. Team pulls changes
5. Resolve merge conflicts
6. Repeat
```

**Deepnote Cloud:**
```
1. Open shared project
2. Edit together in real-time
3. See others' changes live
4. Add comments
5. Changes auto-saved
6. Git sync (optional)
```

**Advantages:**
- ✅ No merge conflicts
- ✅ Real-time updates
- ✅ Instant feedback
- ✅ Built-in discussions

<!-- IMAGE: Screenshot showing real-time collaboration -->
<!-- FILE: realtime-collab-cursors.png -->
<!-- CAPTION: Multiple users editing simultaneously -->

### Data Analysis Workflow

**VS Code Jupyter:**
```python
# Cell 1: Imports
import pandas as pd
import matplotlib.pyplot as plt

# Cell 2: Load data
df = pd.read_csv('data.csv')

# Cell 3: Explore
df.head()
df.describe()

# Cell 4: Analyze
result = df.groupby('category').mean()

# Cell 5: Visualize
result.plot(kind='bar')
plt.show()
```

**Deepnote (Enhanced):**
```python
# Block 1: Imports (same)
import pandas as pd
import matplotlib.pyplot as plt

# Block 2: Input for date range
# Create input-date-range block
# Variable: date_range
# Default: past7days

# Block 3: Load and filter data
df = pd.read_csv('/work/data/data.csv')
df_filtered = df[
    (df['date'] >= date_range[0]) & 
    (df['date'] <= date_range[1])
]
df_filtered.head()

# Block 4: Analyze (auto-updates when date_range changes)
result = df_filtered.groupby('category').mean()
result

# Block 5: Visualize (interactive)
result.plot(kind='bar', figsize=(12, 6))
plt.title(f'Analysis for {date_range[0]} to {date_range[1]}')
plt.show()
```

**Improvements:**
- ✅ Interactive date selection
- ✅ Auto-update on input change
- ✅ Better for exploration
- ✅ Easy to share

## Feature-by-Feature Comparison

### Variable Explorer

**VS Code Jupyter:**
- Variables panel in sidebar
- Shows name, type, value
- Click to inspect
- Limited DataFrame preview

**Deepnote:**
- Variables button in toolbar
- Shows name, type, size
- Full DataFrame viewer
- Interactive exploration

<!-- IMAGE: Variable explorer comparison -->
<!-- FILE: variable-explorer-comparison.png -->
<!-- CAPTION: Variable explorer in VS Code vs Deepnote -->

### Debugging

**VS Code Jupyter:**
```python
# Set breakpoint (click margin)
def analyze(df):
    # Breakpoint here
    result = df.mean()
    return result

# Run cell in debug mode
# Use debug toolbar
```

**Deepnote:**
```python
# Same process
def analyze(df):
    # Click margin for breakpoint
    result = df.mean()
    return result

# Click "Debug Cell" button
# Use debug controls
```

**Both support:**
- ✅ Breakpoints
- ✅ Step through code
- ✅ Variable inspection
- ✅ Watch expressions
- ✅ Call stack

### Git Integration

**VS Code Jupyter:**
- Source Control panel
- Stage changes
- Commit with message
- Push/pull
- View diffs (noisy for .ipynb)

**Deepnote:**
- Git integration built-in
- Auto-commit (optional)
- Clean diffs (.deepnote YAML)
- Sync with remote
- Version history

**Diff Comparison:**

**VS Code Jupyter (.ipynb):**
```diff
  "cells": [
    {
-     "execution_count": 1,
+     "execution_count": 2,
      "outputs": [
        {
-         "data": {"text/plain": "5"},
+         "data": {"text/plain": "10"},
```

**Deepnote (.deepnote):**
```diff
  blocks:
    - content: |
-       x = 5
+       x = 10
```

<!-- IMAGE: Git diff comparison -->
<!-- FILE: git-diff-formats.png -->
<!-- CAPTION: Git diffs: .ipynb vs .deepnote -->

### Extensions and Plugins

**VS Code Jupyter Extensions:**
- Jupyter
- Python
- Pylance
- GitLens
- Prettier

**Deepnote:**
- Native features (no extensions needed)
- Built-in formatting
- Built-in Git
- Built-in collaboration

**What You Might Miss:**
- Custom VS Code extensions
- Specific themes
- Custom keybindings

**What You Gain:**
- No setup required
- Consistent experience
- Built-in best practices

## Advanced Features

### SQL Blocks

**VS Code Jupyter:**
```python
# Cell: Manual SQL
import psycopg2
import pandas as pd

conn = psycopg2.connect(...)
query = """
SELECT customer_id, SUM(amount) as total
FROM orders
GROUP BY customer_id
"""
df = pd.read_sql(query, conn)
conn.close()
```

**Deepnote:**
```sql
-- SQL Block
-- Integration: postgres-prod
-- Variable: df
SELECT customer_id, SUM(amount) as total
FROM orders
GROUP BY customer_id
```

**Advantages:**
- ✅ No connection code
- ✅ SQL syntax highlighting
- ✅ Secure credentials
- ✅ Results as DataFrame
- ✅ Query history

<!-- IMAGE: SQL block in Deepnote -->
<!-- FILE: sql-block-example.png -->
<!-- CAPTION: Native SQL block in Deepnote -->

### Input Blocks

**VS Code Jupyter:**
```python
# Cell: ipywidgets
import ipywidgets as widgets
from IPython.display import display

# Create widgets
start_date = widgets.DatePicker(description='Start')
end_date = widgets.DatePicker(description='End')
threshold = widgets.FloatSlider(min=0, max=1, value=0.5)

display(start_date, end_date, threshold)

# Use values
print(f"Start: {start_date.value}")
print(f"End: {end_date.value}")
print(f"Threshold: {threshold.value}")
```

**Deepnote:**
```python
# Input blocks (no code needed):
# - input-date: start_date
# - input-date: end_date
# - input-slider: threshold (0-1, default 0.5)

# Variables automatically available
print(f"Start: {start_date}")
print(f"End: {end_date}")
print(f"Threshold: {threshold}")
```

**Advantages:**
- ✅ No widget code
- ✅ Cleaner notebooks
- ✅ Better performance
- ✅ Native UI

<!-- IMAGE: Input blocks comparison -->
<!-- FILE: input-blocks-comparison.png -->
<!-- CAPTION: ipywidgets vs Deepnote input blocks -->

### Scheduled Execution

**VS Code Jupyter:**
```bash
# Use cron or Task Scheduler
# crontab -e
0 2 * * * cd /path/to/project && jupyter nbconvert --execute notebook.ipynb
```

**Deepnote:**
1. Click "Schedule" button
2. Choose frequency (hourly, daily, weekly)
3. Set time
4. Configure notifications
5. Done!

**Advantages:**
- ✅ No cron setup
- ✅ Built-in notifications
- ✅ Execution history
- ✅ Easy to manage

### Publishing and Sharing

**VS Code Jupyter:**
```bash
# Export to HTML
jupyter nbconvert --to html notebook.ipynb

# Share via:
# - Email HTML file
# - Upload to GitHub
# - Use nbviewer
# - Deploy with Voilà
```

**Deepnote:**
1. Click "Share" button
2. Choose permissions
3. Generate link
4. Or publish as app

**Advantages:**
- ✅ One-click sharing
- ✅ Interactive sharing
- ✅ Access control
- ✅ No deployment needed

<!-- IMAGE: Sharing options in Deepnote -->
<!-- FILE: sharing-options.png -->
<!-- CAPTION: Sharing and publishing in Deepnote -->

## Migration Scenarios

### Scenario 1: Personal Data Analysis

**Current Setup (VS Code):**
- Local notebooks
- Local data files
- Manual execution
- Export to HTML for sharing

**After Migration (Deepnote Cloud):**
- Cloud notebooks
- Cloud or local data
- Scheduled execution
- Native sharing

**Benefits:**
- ✅ Access from anywhere
- ✅ No local setup
- ✅ Automated runs
- ✅ Easy sharing

### Scenario 2: Team Collaboration

**Current Setup (VS Code):**
- Git repository
- Each person works locally
- Merge conflicts
- Email results

**After Migration (Deepnote Cloud):**
- Shared workspace
- Real-time collaboration
- No merge conflicts
- Built-in discussions

**Benefits:**
- ✅ Work together live
- ✅ Instant feedback
- ✅ No conflicts
- ✅ Better communication

### Scenario 3: Hybrid Workflow

**Setup:**
- Develop locally in VS Code
- Use Deepnote extension
- Sync to Deepnote Cloud for sharing
- Best of both worlds

**Workflow:**
```bash
# Local development
code notebook.deepnote

# Edit and test locally
# ...

# Push to Git
git add notebook.deepnote
git commit -m "Update analysis"
git push

# Deepnote Cloud syncs automatically
# Team can view and collaborate
```

**Benefits:**
- ✅ Local development speed
- ✅ Cloud collaboration
- ✅ Flexible workflow
- ✅ Version control

## Troubleshooting

### Issue: Notebooks Won't Import

**Problem:** Import fails or errors

**Solution:**
```bash
# Clean notebook first
jupyter nbconvert --clear-output --inplace notebook.ipynb

# Check for corrupted cells
# Open in text editor, look for malformed JSON

# Try converting
deepnote-convert notebook.ipynb -o notebook.deepnote

# Or upload directly to Deepnote (auto-converts)
```

### Issue: Extensions Don't Work

**Problem:** VS Code extensions not available in Deepnote

**Solution:**
- Use Deepnote native features
- Or keep using VS Code with Deepnote extension
- Hybrid approach: develop in VS Code, share in Deepnote Cloud

### Issue: Keyboard Shortcuts Different

**Problem:** Muscle memory for VS Code shortcuts

**Solution:**
- Most shortcuts are the same
- Learn new shortcuts gradually
- Use Command Palette (Ctrl/Cmd + Shift + P)
- Check keyboard shortcuts reference

### Issue: File Paths Don't Work

**Problem:** Relative paths fail in Deepnote Cloud

**Solution:**
```python
# VS Code (relative)
df = pd.read_csv('../data/file.csv')

# Deepnote Cloud (absolute)
df = pd.read_csv('/work/data/file.csv')

# Or use pathlib for portability
from pathlib import Path
data_dir = Path('/work/data')  # or Path('data') for local
df = pd.read_csv(data_dir / 'file.csv')
```

## Migration Checklist

### Pre-Migration
- [ ] List all notebooks
- [ ] Document dependencies
- [ ] Note VS Code extensions used
- [ ] Check for local file dependencies
- [ ] Identify database connections
- [ ] Review widget usage

### Migration
- [ ] Clean notebook outputs
- [ ] Convert to .deepnote (optional)
- [ ] Upload to Deepnote
- [ ] Set up environment
- [ ] Add packages
- [ ] Configure integrations
- [ ] Upload data files
- [ ] Update file paths
- [ ] Replace widgets with input blocks

### Testing
- [ ] Run all cells/blocks
- [ ] Verify outputs
- [ ] Test interactivity
- [ ] Check database connections
- [ ] Test sharing
- [ ] Verify Git integration

### Optimization
- [ ] Add markdown documentation
- [ ] Use SQL blocks for queries
- [ ] Add input blocks for parameters
- [ ] Set up schedules (if needed)
- [ ] Configure notifications
- [ ] Invite team members

## Best Practices

### 1. Start Simple

- Migrate simple notebooks first
- Learn Deepnote features
- Then migrate complex notebooks

### 2. Use Both Tools

- Keep VS Code for local development
- Use Deepnote for collaboration
- Sync via Git

### 3. Leverage Deepnote Features

- Use SQL blocks instead of connection code
- Use input blocks instead of widgets
- Use scheduling for automation
- Use sharing for collaboration

### 4. Maintain Compatibility

```python
# Write portable code
import os

# Detect environment
is_deepnote_cloud = os.path.exists('/work')

# Adapt paths
if is_deepnote_cloud:
    data_path = '/work/data'
else:
    data_path = 'data'

df = pd.read_csv(f'{data_path}/file.csv')
```

### 5. Document Your Work

```markdown
# Analysis Title

## Environment
- Python 3.11
- pandas 2.0.0
- Running in: Deepnote Cloud

## Data Sources
- PostgreSQL: production database
- CSV files in /work/data/

## Usage
1. Run all blocks
2. Adjust input parameters
3. Review outputs
```

## Related Documentation

- [Moving from Jupyter to Deepnote](./jupyter-to-deepnote.md) - Jupyter migration
- [Moving from PyCharm to Deepnote](./pycharm-to-deepnote.md) - PyCharm migration
- [Deepnote VS Code Extension](./vscode-extension.md) - Extension guide
- [Running .deepnote in VS Code](./vscode-running.md) - Execution guide

## Conclusion

Moving from VS Code Jupyter to Deepnote is straightforward since both are notebook-based environments. Deepnote adds powerful collaboration, cloud infrastructure, and advanced features while maintaining the familiar notebook workflow you know from VS Code.

**Choose your path:**
- **Full migration** → Deepnote Cloud for collaboration
- **Hybrid approach** → VS Code + Deepnote extension + Cloud sync
- **Local development** → Deepnote extension in VS Code

**Welcome to Deepnote! 🚀**
