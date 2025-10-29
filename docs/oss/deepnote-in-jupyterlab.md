---
title: Using Deepnote Format in JupyterLab
description: Complete guide to working with Deepnote's YAML format in JupyterLab, including conversion, compatibility, and workflow integration.
noIndex: false
noContent: false
---

# Using Deepnote Format in JupyterLab

This guide explains how to work with Deepnote's `.deepnote` files in JupyterLab, convert between formats, and integrate Deepnote into your JupyterLab workflow.

## Understanding the Formats

### Jupyter Format (.ipynb)

**Structure:**
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
  ],
  "metadata": {
    "kernelspec": {
      "name": "python3",
      "display_name": "Python 3"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 5
}
```

**Characteristics:**
- JSON format
- Machine-optimized
- Noisy git diffs
- Single notebook per file
- Outputs embedded

### Deepnote Format (.deepnote)

**Structure:**
```yaml
metadata:
  createdAt: '2025-01-27T12:00:00Z'

version: '1.0.0'

project:
  id: 'project-001'
  name: 'My Analysis'
  
  notebooks:
    - id: 'notebook-001'
      name: 'Analysis'
      blocks:
        - id: 'block-001'
          type: code
          content: |
            print('hello')
          executionCount: 1
```

**Characteristics:**
- YAML format
- Human-readable
- Clean git diffs
- Multiple notebooks per file
- Project-level organization

<!-- IMAGE: Side-by-side comparison of .ipynb vs .deepnote file structure -->
<!-- FILE: format-comparison.png -->
<!-- CAPTION: Jupyter .ipynb vs Deepnote .deepnote format -->

## Why Use Deepnote Format in JupyterLab?

### Advantages

**Version Control:**
- ✅ Clean, readable diffs
- ✅ Easy to review changes
- ✅ Better merge conflict resolution
- ✅ Human-readable format

**Organization:**
- ✅ Multiple notebooks in one file
- ✅ Project-level settings
- ✅ Shared dependencies
- ✅ Integrated integrations

**Collaboration:**
- ✅ Better for code review
- ✅ Easier to understand changes
- ✅ Clear structure
- ✅ Documentation-friendly

**Portability:**
- ✅ Works in JupyterLab
- ✅ Works in VS Code
- ✅ Works in Deepnote Cloud
- ✅ Easy to edit manually

### When to Use Each Format

**Use .ipynb when:**
- Working exclusively in Jupyter ecosystem
- Need compatibility with older tools
- Using Jupyter-specific extensions
- Sharing with Jupyter-only users

**Use .deepnote when:**
- Working with teams
- Need better version control
- Want project-level organization
- Planning to use Deepnote Cloud
- Need multiple notebooks in one project

## Converting Between Formats

### Installing the Converter

```bash
# Install Node.js converter
npm install -g @deepnote/convert

# Or install Python converter
pip install deepnote-convert
```

### Converting .ipynb to .deepnote

**Single Notebook:**
```bash
# Basic conversion
deepnote-convert notebook.ipynb

# Specify output
deepnote-convert notebook.ipynb -o output.deepnote

# With project name
deepnote-convert notebook.ipynb --projectName "My Project"

# Clear outputs
deepnote-convert notebook.ipynb --clearOutputs
```

**Multiple Notebooks:**
```bash
# Convert all notebooks in directory
deepnote-convert notebooks/*.ipynb --projectName "Analysis Project"

# Convert to separate files
for file in notebooks/*.ipynb; do
  deepnote-convert "$file" -o "deepnote/$(basename $file .ipynb).deepnote"
done

# Batch convert with custom names
deepnote-convert \
  notebook1.ipynb \
  notebook2.ipynb \
  notebook3.ipynb \
  --projectName "Complete Analysis"
```

**Python Script:**
```python
from deepnote_convert import convert_notebook

# Convert single file
convert_notebook(
    'notebook.ipynb',
    'notebook.deepnote',
    project_name='My Project',
    clear_outputs=True
)

# Convert multiple files
notebooks = ['nb1.ipynb', 'nb2.ipynb', 'nb3.ipynb']
for nb in notebooks:
    output = nb.replace('.ipynb', '.deepnote')
    convert_notebook(nb, output)
```

<!-- IMAGE: Screenshot of conversion process in terminal -->
<!-- FILE: conversion-terminal.png -->
<!-- CAPTION: Converting notebooks from .ipynb to .deepnote -->

### Converting .deepnote to .ipynb

**Export from Deepnote:**
```bash
# Using deepnote-cli (if available)
deepnote-cli export notebook.deepnote -o notebook.ipynb

# Or manually parse YAML and convert
python convert_deepnote_to_ipynb.py notebook.deepnote
```

**Python Conversion Script:**
```python
import yaml
import json

def deepnote_to_ipynb(deepnote_file, output_file):
    """Convert .deepnote to .ipynb format."""
    
    # Load Deepnote file
    with open(deepnote_file, 'r') as f:
        deepnote_data = yaml.safe_load(f)
    
    # Extract first notebook
    notebook = deepnote_data['project']['notebooks'][0]
    
    # Convert blocks to cells
    cells = []
    for block in notebook['blocks']:
        if block['type'] == 'code':
            cell = {
                'cell_type': 'code',
                'execution_count': block.get('executionCount'),
                'metadata': block.get('metadata', {}),
                'outputs': block.get('outputs', []),
                'source': block['content'].split('\n')
            }
        elif block['type'].startswith('text-cell'):
            cell = {
                'cell_type': 'markdown',
                'metadata': {},
                'source': [block['content']]
            }
        else:
            continue  # Skip unsupported block types
        
        cells.append(cell)
    
    # Create Jupyter notebook structure
    ipynb = {
        'cells': cells,
        'metadata': {
            'kernelspec': {
                'name': 'python3',
                'display_name': 'Python 3'
            },
            'language_info': {
                'name': 'python',
                'version': '3.11.0'
            }
        },
        'nbformat': 4,
        'nbformat_minor': 5
    }
    
    # Save as .ipynb
    with open(output_file, 'w') as f:
        json.dump(ipynb, f, indent=2)

# Usage
deepnote_to_ipynb('notebook.deepnote', 'notebook.ipynb')
```

## Opening .deepnote Files in JupyterLab

### Method 1: Convert First (Recommended)

```bash
# Convert to .ipynb
deepnote-convert notebook.deepnote -o notebook.ipynb

# Open in JupyterLab
jupyter lab notebook.ipynb
```

### Method 2: Custom Viewer Extension

**Create JupyterLab Extension:**

```typescript
// src/index.ts
import { JupyterFrontEnd } from '@jupyterlab/application';
import { IDocumentWidget } from '@jupyterlab/docregistry';

// Register .deepnote file type
const extension = {
  id: 'deepnote-viewer',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    app.docRegistry.addFileType({
      name: 'deepnote',
      extensions: ['.deepnote'],
      mimeTypes: ['text/yaml'],
      iconClass: 'jp-MaterialIcon jp-NotebookIcon'
    });
  }
};

export default extension;
```

**Note:** Full extension development is beyond this guide's scope. For now, convert to .ipynb format.

### Method 3: Manual Editing

```bash
# Open as YAML file
jupyter lab notebook.deepnote

# JupyterLab will open it as text
# You can edit the YAML directly
```

<!-- IMAGE: Screenshot of .deepnote file opened in JupyterLab -->
<!-- FILE: deepnote-in-jupyterlab.png -->
<!-- CAPTION: Viewing .deepnote file in JupyterLab -->

## Working with Both Formats

### Hybrid Workflow

**Setup:**
```
project/
├── notebooks/
│   ├── analysis.ipynb        # JupyterLab working copy
│   └── analysis.deepnote     # Deepnote format for Git
├── scripts/
│   ├── convert.sh
│   └── sync.py
└── requirements.txt
```

**Conversion Script:**
```bash
#!/bin/bash
# convert.sh - Convert between formats

case "$1" in
  to-deepnote)
    for file in notebooks/*.ipynb; do
      deepnote-convert "$file" -o "${file%.ipynb}.deepnote"
    done
    ;;
  to-ipynb)
    for file in notebooks/*.deepnote; do
      python scripts/convert_to_ipynb.py "$file"
    done
    ;;
  *)
    echo "Usage: $0 {to-deepnote|to-ipynb}"
    exit 1
    ;;
esac
```

**Sync Script:**
```python
# sync.py - Keep formats in sync
import os
import subprocess
from pathlib import Path

def sync_notebooks(direction='to-deepnote'):
    """Sync notebooks between formats."""
    notebooks_dir = Path('notebooks')
    
    if direction == 'to-deepnote':
        # Convert .ipynb to .deepnote
        for ipynb in notebooks_dir.glob('*.ipynb'):
            deepnote = ipynb.with_suffix('.deepnote')
            print(f"Converting {ipynb.name} → {deepnote.name}")
            subprocess.run([
                'deepnote-convert',
                str(ipynb),
                '-o', str(deepnote)
            ])
    
    elif direction == 'to-ipynb':
        # Convert .deepnote to .ipynb
        for deepnote in notebooks_dir.glob('*.deepnote'):
            ipynb = deepnote.with_suffix('.ipynb')
            print(f"Converting {deepnote.name} → {ipynb.name}")
            # Use your conversion function
            deepnote_to_ipynb(str(deepnote), str(ipynb))

if __name__ == '__main__':
    import sys
    direction = sys.argv[1] if len(sys.argv) > 1 else 'to-deepnote'
    sync_notebooks(direction)
```

**Git Hooks:**

```bash
# .git/hooks/pre-commit
#!/bin/bash
# Convert .ipynb to .deepnote before commit

for file in notebooks/*.ipynb; do
  if [ -f "$file" ]; then
    deepnote="${file%.ipynb}.deepnote"
    deepnote-convert "$file" -o "$deepnote" --clearOutputs
    git add "$deepnote"
  fi
done
```

<!-- IMAGE: Diagram showing hybrid workflow -->
<!-- FILE: hybrid-workflow-diagram.png -->
<!-- CAPTION: Hybrid workflow: JupyterLab + Deepnote format -->

## JupyterLab Workflow Integration

### Daily Workflow

**Morning (Start Work):**
```bash
# 1. Pull latest changes
git pull origin main

# 2. Convert .deepnote to .ipynb
./scripts/convert.sh to-ipynb

# 3. Start JupyterLab
jupyter lab
```

**During Work:**
```bash
# Work in JupyterLab with .ipynb files
# Edit, run, test as normal
```

**Evening (End Work):**
```bash
# 1. Convert .ipynb to .deepnote
./scripts/convert.sh to-deepnote

# 2. Stage Deepnote files for commit
git add notebooks/*.deepnote

# 3. Commit changes
git commit -m "Update analysis notebooks"

# 4. Push to remote
git push origin main
```

### Automated Workflow

**Using Makefile:**
```makefile
# Makefile
.PHONY: start sync commit

start:
	./scripts/convert.sh to-ipynb
	jupyter lab

sync:
	./scripts/convert.sh to-deepnote

commit: sync
	git add notebooks/*.deepnote
	git commit -m "Update notebooks"
	git push origin main

clean:
	rm -f notebooks/*.ipynb
```

**Usage:**
```bash
# Start working
make start

# Sync and commit
make commit

# Clean working copies
make clean
```

## Handling Deepnote-Specific Features

### SQL Blocks

**In Deepnote:**
```yaml
blocks:
  - type: sql
    content: |
      SELECT * FROM users
      WHERE active = true
    metadata:
      deepnote_variable_name: active_users
      sql_integration_id: postgres-prod
```

**In JupyterLab (after conversion):**
```python
# Converted to code cell with comment
# SQL Block: active_users
# Integration: postgres-prod

# You'll need to add connection code:
import psycopg2
import pandas as pd

conn = psycopg2.connect(...)
active_users = pd.read_sql("""
SELECT * FROM users
WHERE active = true
""", conn)
```

**Recommendation:**
- Keep SQL in Deepnote format for cloud execution
- Convert to Python for local JupyterLab work
- Or use both: SQL blocks in Deepnote, Python in JupyterLab

### Input Blocks

**In Deepnote:**
```yaml
blocks:
  - type: input-slider
    metadata:
      deepnote_variable_name: threshold
      deepnote_variable_value: '0.5'
      deepnote_slider_min_value: 0
      deepnote_slider_max_value: 1
```

**In JupyterLab (after conversion):**
```python
# Converted to code cell with variable assignment
threshold = 0.5

# Or use ipywidgets
import ipywidgets as widgets
threshold_slider = widgets.FloatSlider(
    value=0.5,
    min=0,
    max=1,
    description='Threshold:'
)
display(threshold_slider)
```

### Visualization Blocks

**In Deepnote:**
```yaml
blocks:
  - type: visualization
    metadata:
      deepnote_chart_spec:
        mark: bar
        encoding:
          x: {field: category}
          y: {field: value}
```

**In JupyterLab (after conversion):**
```python
# Converted to code cell with plotting code
import matplotlib.pyplot as plt

df.plot(kind='bar', x='category', y='value')
plt.show()

# Or use Altair (closer to Vega-Lite)
import altair as alt

alt.Chart(df).mark_bar().encode(
    x='category',
    y='value'
)
```

<!-- IMAGE: Screenshot showing converted blocks in JupyterLab -->
<!-- FILE: converted-blocks-jupyterlab.png -->
<!-- CAPTION: Deepnote blocks converted to JupyterLab cells -->

## Version Control Best Practices

### Git Configuration

**.gitignore:**
```gitignore
# JupyterLab
.ipynb_checkpoints/
*.ipynb

# Keep Deepnote format
!*.deepnote

# Python
__pycache__/
*.pyc
.venv/

# Data
data/raw/*
data/processed/*

# Outputs
outputs/*
```

**Why ignore .ipynb?**
- Noisy diffs
- Large file sizes (with outputs)
- Binary-like format
- Merge conflicts

**Why keep .deepnote?**
- Clean diffs
- Human-readable
- Better for review
- Smaller file sizes

### Viewing Diffs

**Jupyter Format (.ipynb):**
```diff
  "cells": [
    {
-     "execution_count": 1,
+     "execution_count": 2,
      "outputs": [
        {
-         "data": {"text/plain": "[1, 2, 3]"},
+         "data": {"text/plain": "[1, 2, 3, 4]"},
          "execution_count": 1,
          "metadata": {},
          "output_type": "execute_result"
        }
      ],
```

**Deepnote Format (.deepnote):**
```diff
  blocks:
    - content: |
-       result = [1, 2, 3]
+       result = [1, 2, 3, 4]
      type: code
```

<!-- IMAGE: Git diff comparison showing .ipynb vs .deepnote -->
<!-- FILE: git-diff-comparison.png -->
<!-- CAPTION: Git diffs: .ipynb (noisy) vs .deepnote (clean) -->

### Code Review

**Reviewing .deepnote Changes:**
```bash
# View changes
git diff notebooks/analysis.deepnote

# Review specific blocks
git diff notebooks/analysis.deepnote | grep -A 10 "content:"

# Compare with previous version
git diff HEAD~1 notebooks/analysis.deepnote
```

**Better Code Review:**
- Easy to see what changed
- Clear block-by-block changes
- No noise from outputs
- Human-readable format

## Multi-Notebook Projects

### Project Structure

**Single .deepnote File:**
```yaml
project:
  name: 'Data Analysis Project'
  
  notebooks:
    - id: 'nb-001'
      name: 'Data Loading'
      blocks: [...]
    
    - id: 'nb-002'
      name: 'Data Cleaning'
      blocks: [...]
    
    - id: 'nb-003'
      name: 'Analysis'
      blocks: [...]
  
  settings:
    environment:
      pythonVersion: '3.11'
    requirements:
      - 'pandas>=2.0.0'
      - 'numpy>=1.24.0'
```

**Converting to JupyterLab:**
```bash
# Extract individual notebooks
python extract_notebooks.py project.deepnote

# Creates:
# - data_loading.ipynb
# - data_cleaning.ipynb
# - analysis.ipynb
```

**Extraction Script:**
```python
# extract_notebooks.py
import yaml
import json
from pathlib import Path

def extract_notebooks(deepnote_file, output_dir='notebooks'):
    """Extract individual notebooks from .deepnote file."""
    
    # Load Deepnote file
    with open(deepnote_file, 'r') as f:
        data = yaml.safe_load(f)
    
    # Create output directory
    Path(output_dir).mkdir(exist_ok=True)
    
    # Extract each notebook
    for notebook in data['project']['notebooks']:
        # Convert blocks to cells
        cells = []
        for block in notebook['blocks']:
            if block['type'] == 'code':
                cell = {
                    'cell_type': 'code',
                    'execution_count': block.get('executionCount'),
                    'metadata': {},
                    'outputs': block.get('outputs', []),
                    'source': block['content'].split('\n')
                }
                cells.append(cell)
            elif block['type'].startswith('text-cell'):
                cell = {
                    'cell_type': 'markdown',
                    'metadata': {},
                    'source': [block['content']]
                }
                cells.append(cell)
        
        # Create .ipynb structure
        ipynb = {
            'cells': cells,
            'metadata': {
                'kernelspec': {
                    'name': 'python3',
                    'display_name': 'Python 3'
                }
            },
            'nbformat': 4,
            'nbformat_minor': 5
        }
        
        # Save notebook
        name = notebook['name'].lower().replace(' ', '_')
        output_file = Path(output_dir) / f"{name}.ipynb"
        with open(output_file, 'w') as f:
            json.dump(ipynb, f, indent=2)
        
        print(f"Created: {output_file}")

if __name__ == '__main__':
    import sys
    deepnote_file = sys.argv[1] if len(sys.argv) > 1 else 'project.deepnote'
    extract_notebooks(deepnote_file)
```

<!-- IMAGE: Screenshot showing multiple notebooks extracted from one .deepnote file -->
<!-- FILE: extracted-notebooks.png -->
<!-- CAPTION: Multiple notebooks extracted from single .deepnote file -->

## Troubleshooting

### Issue: Conversion Fails

**Problem:** `deepnote-convert` fails with errors

**Solution:**
```bash
# Check notebook is valid
jupyter nbconvert --to notebook --execute notebook.ipynb

# Clear outputs first
jupyter nbconvert --clear-output --inplace notebook.ipynb

# Try conversion again
deepnote-convert notebook.ipynb

# Check for corrupted cells
python -m json.tool notebook.ipynb > /dev/null
```

### Issue: Lost Metadata

**Problem:** Metadata lost during conversion

**Solution:**
```python
# Preserve custom metadata
def convert_with_metadata(ipynb_file, deepnote_file):
    # Load .ipynb
    with open(ipynb_file) as f:
        ipynb = json.load(f)
    
    # Extract custom metadata
    custom_meta = ipynb.get('metadata', {}).get('custom', {})
    
    # Convert
    subprocess.run(['deepnote-convert', ipynb_file, '-o', deepnote_file])
    
    # Add custom metadata back
    with open(deepnote_file) as f:
        deepnote = yaml.safe_load(f)
    
    deepnote['project']['metadata'] = custom_meta
    
    with open(deepnote_file, 'w') as f:
        yaml.dump(deepnote, f)
```

### Issue: SQL Blocks Don't Work

**Problem:** SQL blocks don't execute in JupyterLab

**Solution:**
- SQL blocks are Deepnote-specific
- Convert to Python code with database connections
- Or use JupyterLab SQL magic: `%%sql`
- Or keep SQL blocks for Deepnote Cloud execution

### Issue: Input Blocks Missing

**Problem:** Input blocks don't appear after conversion

**Solution:**
```python
# Input blocks convert to variable assignments
# In JupyterLab, replace with ipywidgets

import ipywidgets as widgets
from IPython.display import display

# Create widget
slider = widgets.FloatSlider(value=0.5, min=0, max=1)
display(slider)

# Use value
threshold = slider.value
```

## Best Practices

### 1. Choose Your Primary Format

**Option A: Deepnote Primary**
- Work in Deepnote Cloud
- Export to .ipynb for JupyterLab
- Commit .deepnote to Git

**Option B: JupyterLab Primary**
- Work in JupyterLab with .ipynb
- Convert to .deepnote for Git
- Sync to Deepnote Cloud

**Option C: Hybrid**
- Develop in JupyterLab (.ipynb)
- Convert to .deepnote for version control
- Deploy to Deepnote Cloud for sharing

### 2. Automate Conversions

```bash
# Add to .git/hooks/pre-commit
#!/bin/bash
for file in notebooks/*.ipynb; do
  deepnote-convert "$file" -o "${file%.ipynb}.deepnote" --clearOutputs
  git add "${file%.ipynb}.deepnote"
done
```

### 3. Document Your Workflow

```markdown
# Project Workflow

## For Developers
1. Work in JupyterLab with .ipynb files
2. Convert to .deepnote before committing
3. Push .deepnote files to Git

## For Reviewers
1. Review .deepnote files (clean diffs)
2. Convert to .ipynb for testing
3. Approve changes

## For Deployment
1. Use .deepnote files in Deepnote Cloud
2. Scheduled runs use cloud version
3. Share via Deepnote
```

### 4. Keep Formats in Sync

```python
# sync_check.py - Verify formats are in sync
import os
from pathlib import Path

def check_sync(notebooks_dir='notebooks'):
    """Check if .ipynb and .deepnote are in sync."""
    
    issues = []
    
    for ipynb in Path(notebooks_dir).glob('*.ipynb'):
        deepnote = ipynb.with_suffix('.deepnote')
        
        if not deepnote.exists():
            issues.append(f"Missing: {deepnote.name}")
            continue
        
        # Check modification times
        if ipynb.stat().st_mtime > deepnote.stat().st_mtime:
            issues.append(f"Out of sync: {ipynb.name} newer than {deepnote.name}")
    
    if issues:
        print("⚠️  Sync issues found:")
        for issue in issues:
            print(f"  - {issue}")
        return False
    else:
        print("✓ All notebooks in sync")
        return True

if __name__ == '__main__':
    check_sync()
```

## Related Documentation

- [Reading .deepnote Files](./reading-deepnote-files.md) - File format details
- [Deepnote Format](./deepnote-format.md) - Format specification
- [Moving from Jupyter to Deepnote](./jupyter-to-deepnote.md) - Migration guide
- [Organizing Notebooks into Projects](./organizing-notebooks.md) - Project structure

## Conclusion

Using Deepnote format in JupyterLab provides the best of both worlds: the familiar JupyterLab interface for development and Deepnote's superior format for version control and collaboration. With proper conversion workflows and automation, you can seamlessly work between both environments.

**Choose your workflow and automate it! 🔄**
