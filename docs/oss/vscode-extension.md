---
title: Deepnote VS Code Extension
description: Complete guide to the official Deepnote VS Code extension for working with Deepnote notebooks locally in Visual Studio Code.
noIndex: false
noContent: false
---

# Deepnote VS Code Extension

The official Deepnote VS Code extension brings the power of Deepnote notebooks to your local development environment. Work with `.deepnote` files directly in VS Code with full support for execution, debugging, and collaboration.

## Overview

The Deepnote extension for VS Code provides:

- **Native `.deepnote` file support** - Open and edit Deepnote notebooks
- **Block execution** - Run code, SQL, and other executable blocks
- **Rich outputs** - Display DataFrames, plots, and visualizations
- **IntelliSense** - Code completion and suggestions
- **Debugging** - Set breakpoints and debug code blocks
- **Git integration** - Version control for notebooks
- **Local execution** - Use your own Python environment

<!-- IMAGE: Screenshot of Deepnote extension in VS Code marketplace -->
<!-- FILE: vscode-extension-marketplace.png -->
<!-- CAPTION: Deepnote extension in VS Code marketplace -->

## Installation

### From VS Code Marketplace

1. **Open VS Code**
   - Launch Visual Studio Code

2. **Open Extensions View**
   - Click Extensions icon in sidebar (Ctrl/Cmd + Shift + X)
   - Or go to View → Extensions

<!-- IMAGE: Screenshot of VS Code Extensions sidebar -->
<!-- FILE: vscode-extensions-sidebar.png -->
<!-- CAPTION: VS Code Extensions view -->

3. **Search for Deepnote**
   - Type "Deepnote" in the search box
   - Find "Deepnote" by Deepnote

<!-- IMAGE: Screenshot of Deepnote extension search results -->
<!-- FILE: deepnote-extension-search.png -->
<!-- CAPTION: Searching for Deepnote extension -->

4. **Install**
   - Click "Install" button
   - Wait for installation to complete
   - Reload VS Code if prompted

<!-- IMAGE: Screenshot showing installed Deepnote extension -->
<!-- FILE: deepnote-extension-installed.png -->
<!-- CAPTION: Successfully installed Deepnote extension -->

### From Command Line

```bash
# Install using VS Code CLI
code --install-extension deepnote.deepnote
```

### Verify Installation

1. Open Command Palette (Ctrl/Cmd + Shift + P)
2. Type "Deepnote"
3. You should see Deepnote-related commands

<!-- IMAGE: Screenshot of Command Palette showing Deepnote commands -->
<!-- FILE: deepnote-commands-palette.png -->
<!-- CAPTION: Deepnote commands in Command Palette -->

## Features

### 1. Native .deepnote File Support

**File Association:**
- `.deepnote` files automatically open in notebook interface
- YAML syntax highlighting for raw view
- Structured notebook view for editing

**View Modes:**
- **Notebook View** - Interactive editing and execution
- **Source View** - Raw YAML editing
- **Split View** - Both views side-by-side

<!-- IMAGE: Screenshot showing notebook view vs source view -->
<!-- FILE: notebook-vs-source-view.png -->
<!-- CAPTION: Notebook view and source view comparison -->

### 2. Block Execution

**Supported Block Types:**
- ✅ Code blocks (Python)
- ✅ SQL blocks (with database connections)
- ✅ Input blocks (all types)
- ✅ Markdown blocks (rendered)

**Execution Controls:**
- Run single block: Click play button or Shift + Enter
- Run all blocks: Ctrl/Cmd + Shift + Enter
- Run above: Execute all blocks above current
- Run below: Execute all blocks below current
- Clear outputs: Remove all execution results

<!-- IMAGE: Screenshot showing block execution controls -->
<!-- FILE: block-execution-controls.png -->
<!-- CAPTION: Block execution controls and shortcuts -->

### 3. Rich Output Display

**Supported Output Types:**
- Text output (stdout/stderr)
- DataFrames (interactive tables)
- Plots (matplotlib, seaborn, plotly)
- Images (PNG, JPEG, SVG)
- HTML content
- JSON/dict pretty-printing
- Error tracebacks

<!-- IMAGE: Screenshot showing various output types -->
<!-- FILE: rich-output-display.png -->
<!-- CAPTION: Different output types in VS Code -->

### 4. IntelliSense and Code Completion

**Features:**
- Auto-completion for Python code
- Function signatures and documentation
- Import suggestions
- Variable inspection
- Type hints

**Trigger IntelliSense:**
- Type and pause (auto-trigger)
- Ctrl/Cmd + Space (manual trigger)

<!-- IMAGE: Screenshot of IntelliSense in action -->
<!-- FILE: intellisense-completion.png -->
<!-- CAPTION: IntelliSense code completion -->

### 5. Debugging Support

**Debug Features:**
- Set breakpoints in code blocks
- Step through execution
- Inspect variables
- Evaluate expressions
- View call stack

**Start Debugging:**
1. Set breakpoint (click left margin)
2. Click "Debug Cell" button
3. Use debug controls to step through

<!-- IMAGE: Screenshot of debugging interface with breakpoints -->
<!-- FILE: debugging-interface.png -->
<!-- CAPTION: Debugging a code block in VS Code -->

### 6. Variable Explorer

**View Variables:**
- See all variables in current scope
- Inspect values and types
- View DataFrame shapes
- Expand nested structures

**Access Variable Explorer:**
- Click "Variables" in notebook toolbar
- Or use Command Palette: "Deepnote: Show Variables"

<!-- IMAGE: Screenshot of Variable Explorer panel -->
<!-- FILE: variable-explorer.png -->
<!-- CAPTION: Variable Explorer showing notebook variables -->

### 7. SQL Block Support

**Features:**
- Syntax highlighting for SQL
- Execute queries against databases
- Display results as DataFrames
- Variable assignment
- Connection management

**Requirements:**
- Database drivers installed
- Connection details in environment variables

<!-- IMAGE: Screenshot of SQL block execution -->
<!-- FILE: sql-block-execution.png -->
<!-- CAPTION: Executing SQL block in VS Code -->

### 8. Input Blocks

**Interactive Inputs:**
- Text inputs
- Checkboxes
- Dropdowns
- Sliders
- Date pickers
- File selectors

**Usage:**
- Change input values in UI
- Re-run dependent blocks
- Values saved to notebook

<!-- IMAGE: Screenshot showing various input block types -->
<!-- FILE: input-blocks-vscode.png -->
<!-- CAPTION: Interactive input blocks in VS Code -->

## Configuration

### Extension Settings

Access settings via:
- File → Preferences → Settings (Ctrl/Cmd + ,)
- Search for "Deepnote"

**Available Settings:**

```json
{
  // Python interpreter path
  "deepnote.pythonPath": "/usr/local/bin/python3",
  
  // Auto-save notebooks
  "deepnote.autoSave": true,
  
  // Auto-save delay (ms)
  "deepnote.autoSaveDelay": 1000,
  
  // Show line numbers
  "deepnote.showLineNumbers": true,
  
  // Enable IntelliSense
  "deepnote.intelliSense": true,
  
  // Max output lines
  "deepnote.maxOutputLines": 1000,
  
  // Enable SQL syntax highlighting
  "deepnote.sqlSyntaxHighlighting": true,
  
  // Default execution mode
  "deepnote.executionMode": "block",
  
  // Show execution time
  "deepnote.showExecutionTime": true,
  
  // Enable debugging
  "deepnote.enableDebugging": true
}
```

<!-- IMAGE: Screenshot of Deepnote extension settings -->
<!-- FILE: extension-settings.png -->
<!-- CAPTION: Deepnote extension settings in VS Code -->

### Python Environment

**Select Python Interpreter:**

1. Open Command Palette (Ctrl/Cmd + Shift + P)
2. Type "Python: Select Interpreter"
3. Choose your Python environment

**Recommended Setup:**
```bash
# Create virtual environment
python -m venv .venv

# Activate it
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

# Install dependencies
pip install deepnote-toolkit pandas numpy
```

<!-- IMAGE: Screenshot of Python interpreter selection -->
<!-- FILE: python-interpreter-selection.png -->
<!-- CAPTION: Selecting Python interpreter -->

### Database Connections

**Set Environment Variables:**

Create `.env` file in project root:
```bash
# PostgreSQL
SQL_POSTGRES_PROD={"host":"localhost","port":5432,"database":"mydb","username":"user","password":"pass"}

# Snowflake
SQL_SNOWFLAKE_WAREHOUSE={"account":"xy12345","user":"analyst","password":"pass","warehouse":"COMPUTE_WH"}

# MySQL
SQL_MYSQL_DEV={"host":"localhost","port":3306,"database":"testdb","username":"root","password":"pass"}
```

**Load in Notebook:**
```python
# First block - load environment variables
from dotenv import load_dotenv
load_dotenv()
```

## Keyboard Shortcuts

### Execution Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Run cell | Shift + Enter | Shift + Return |
| Run cell and insert below | Alt + Enter | Option + Return |
| Run all cells | Ctrl + Shift + Enter | Cmd + Shift + Return |
| Run above | Ctrl + Shift + Up | Cmd + Shift + Up |
| Run below | Ctrl + Shift + Down | Cmd + Shift + Down |

### Navigation Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Next cell | Down | Down |
| Previous cell | Up | Up |
| Insert cell above | Ctrl + Shift + A | Cmd + Shift + A |
| Insert cell below | Ctrl + Shift + B | Cmd + Shift + B |
| Delete cell | Ctrl + Shift + D | Cmd + Shift + D |

### Editing Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Toggle line comment | Ctrl + / | Cmd + / |
| Toggle block comment | Ctrl + Shift + / | Cmd + Shift + / |
| Format cell | Shift + Alt + F | Shift + Option + F |
| Trigger IntelliSense | Ctrl + Space | Cmd + Space |

### View Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Toggle source view | Ctrl + K V | Cmd + K V |
| Show variables | Ctrl + Shift + V | Cmd + Shift + V |
| Command Palette | Ctrl + Shift + P | Cmd + Shift + P |

<!-- IMAGE: Screenshot showing keyboard shortcuts overlay -->
<!-- FILE: keyboard-shortcuts.png -->
<!-- CAPTION: Keyboard shortcuts reference -->

## Working with Blocks

### Creating Blocks

**Add Code Block:**
1. Click "+" button between blocks
2. Select "Code" from dropdown
3. Start typing Python code

**Add SQL Block:**
1. Click "+" button
2. Select "SQL"
3. Write SQL query
4. Configure integration

**Add Markdown Block:**
1. Click "+" button
2. Select "Markdown"
3. Write markdown content

<!-- IMAGE: Screenshot of block type selector -->
<!-- FILE: block-type-selector.png -->
<!-- CAPTION: Selecting block type when creating new block -->

### Editing Blocks

**Code Editing:**
- Full Python syntax highlighting
- Auto-indentation
- Bracket matching
- Multi-cursor editing

**Block Metadata:**
- Right-click block → "Edit Metadata"
- Configure block-specific settings
- Set execution order

### Moving Blocks

**Reorder Blocks:**
- Drag and drop blocks
- Or use move up/down buttons
- Sorting keys update automatically

### Deleting Blocks

**Remove Block:**
- Click delete icon
- Or use Ctrl/Cmd + Shift + D
- Confirm deletion

## Output Management

### Viewing Outputs

**Output Panel:**
- Appears below each executed block
- Scrollable for long outputs
- Collapsible to save space

**Output Types:**
- Text: Plain text output
- Tables: Interactive DataFrames
- Plots: Rendered visualizations
- Errors: Formatted tracebacks

<!-- IMAGE: Screenshot showing different output panels -->
<!-- FILE: output-panels.png -->
<!-- CAPTION: Various output types displayed -->

### Clearing Outputs

**Clear Single Output:**
- Click "Clear Output" button on block
- Or right-click → "Clear Output"

**Clear All Outputs:**
- Command Palette → "Deepnote: Clear All Outputs"
- Or click "Clear All" in toolbar

### Exporting Outputs

**Export Options:**
- Copy output as text
- Save DataFrame as CSV
- Export plot as image
- Download HTML output

## Debugging

### Setting Breakpoints

1. **Add Breakpoint:**
   - Click left margin next to line number
   - Red dot appears

2. **Conditional Breakpoint:**
   - Right-click margin → "Add Conditional Breakpoint"
   - Enter condition (e.g., `x > 10`)

<!-- IMAGE: Screenshot showing breakpoint in code -->
<!-- FILE: breakpoint-example.png -->
<!-- CAPTION: Setting a breakpoint in a code block -->

### Debug Controls

**Start Debugging:**
- Click "Debug Cell" button
- Or F5 to start debugging

**Debug Actions:**
- Continue (F5)
- Step Over (F10)
- Step Into (F11)
- Step Out (Shift + F11)
- Stop (Shift + F5)

**Debug Panel:**
- Variables view
- Watch expressions
- Call stack
- Breakpoints list

<!-- IMAGE: Screenshot of debug panel with variables -->
<!-- FILE: debug-panel.png -->
<!-- CAPTION: Debug panel showing variables and call stack -->

### Inspecting Variables

**During Debugging:**
- Hover over variables to see values
- Add to watch list
- Evaluate expressions in debug console

## Git Integration

### Version Control

**Initialize Git:**
```bash
git init
git add *.deepnote
git commit -m "Initial commit"
```

**Track Changes:**
- VS Code shows modified files
- View diffs in source control panel
- Commit changes with messages

<!-- IMAGE: Screenshot of Git integration in VS Code -->
<!-- FILE: git-integration.png -->
<!-- CAPTION: Git source control panel -->

### Viewing Diffs

**Compare Changes:**
- Click file in source control panel
- View side-by-side diff
- YAML format shows clean diffs

**Merge Conflicts:**
- VS Code highlights conflicts
- Resolve using merge editor
- Validate YAML syntax after merge

### Branches and Collaboration

**Create Branch:**
```bash
git checkout -b feature/new-analysis
```

**Push to Remote:**
```bash
git push origin feature/new-analysis
```

## Performance Tips

### Optimize Execution

**1. Use Virtual Environments:**
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**2. Limit Output Size:**
```python
# Limit DataFrame display
pd.set_option('display.max_rows', 100)

# Limit plot size
plt.figure(figsize=(8, 6))
```

**3. Cache Results:**
```python
# Cache expensive computations
import functools

@functools.lru_cache(maxsize=128)
def expensive_function(x):
    # ... computation
    return result
```

### Memory Management

**Monitor Memory:**
```python
import psutil
import os

process = psutil.Process(os.getpid())
print(f"Memory usage: {process.memory_info().rss / 1024 / 1024:.2f} MB")
```

**Clear Variables:**
```python
# Delete large objects
del large_dataframe
import gc
gc.collect()
```

## Troubleshooting

### Extension Not Working

**Problem:** Extension doesn't activate

**Solutions:**
1. Reload VS Code window
2. Check extension is enabled
3. Update to latest version
4. Check VS Code version compatibility

### Blocks Not Executing

**Problem:** Code blocks don't run

**Solutions:**
1. Verify Python interpreter is selected
2. Check Python environment is activated
3. Install required packages
4. Restart kernel

**Restart Kernel:**
- Command Palette → "Deepnote: Restart Kernel"
- Or click restart icon in toolbar

### IntelliSense Not Working

**Problem:** No code completion

**Solutions:**
1. Install Python extension
2. Select correct interpreter
3. Install language server
4. Reload window

### SQL Blocks Failing

**Problem:** SQL blocks don't execute

**Solutions:**
1. Check environment variables are set
2. Install database drivers
3. Test connection manually
4. Verify integration ID

### Output Not Displaying

**Problem:** Outputs don't show

**Solutions:**
1. Check output panel is open
2. Clear and re-run block
3. Check for errors in console
4. Verify output size limits

## Best Practices

### Project Organization

**Recommended Structure:**
```
my-project/
├── .venv/                 # Virtual environment
├── .env                   # Environment variables
├── .gitignore            # Git ignore file
├── requirements.txt      # Python dependencies
├── README.md            # Project documentation
├── data/                # Data files
├── notebooks/           # Deepnote notebooks
│   ├── 01_loading.deepnote
│   ├── 02_processing.deepnote
│   └── 03_analysis.deepnote
└── outputs/             # Generated outputs
```

### Naming Conventions

**Notebooks:**
- Use descriptive names
- Add number prefixes for order
- Use lowercase with hyphens

```
01_data-loading.deepnote
02_data-cleaning.deepnote
03_exploratory-analysis.deepnote
04_model-training.deepnote
```

### Documentation

**Add Markdown Blocks:**
```markdown
# Project Title

## Overview
Brief description of the notebook purpose.

## Requirements
- Python 3.9+
- pandas, numpy, scikit-learn

## Usage
1. Run data loading blocks
2. Execute analysis blocks
3. Review outputs
```

### Code Quality

**Use Linting:**
```bash
# Install linters
pip install pylint black

# Format code
black notebook.py

# Check code quality
pylint notebook.py
```

**Type Hints:**
```python
def process_data(df: pd.DataFrame) -> pd.DataFrame:
    """Process the input DataFrame."""
    return df.dropna()
```

## Advanced Features

### Custom Snippets

Create code snippets for common patterns:

**File:** `.vscode/deepnote.code-snippets`
```json
{
  "Import Data Science Libraries": {
    "prefix": "ds-imports",
    "body": [
      "import pandas as pd",
      "import numpy as np",
      "import matplotlib.pyplot as plt",
      "import seaborn as sns"
    ]
  }
}
```

### Task Automation

**Use Tasks:**

**File:** `.vscode/tasks.json`
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run All Notebooks",
      "type": "shell",
      "command": "python",
      "args": ["-m", "deepnote", "run", "notebooks/*.deepnote"]
    }
  ]
}
```

### Multi-Root Workspaces

**Work with Multiple Projects:**
```json
{
  "folders": [
    { "path": "project-a" },
    { "path": "project-b" },
    { "path": "shared-utils" }
  ]
}
```

## Extensions Compatibility

### Recommended Extensions

**Essential:**
- Python (Microsoft)
- Jupyter (Microsoft)
- YAML (Red Hat)

**Helpful:**
- GitLens
- Prettier
- ESLint
- Docker

**Data Science:**
- Data Wrangler
- Rainbow CSV
- SQL Tools

<!-- IMAGE: Screenshot of recommended extensions -->
<!-- FILE: recommended-extensions.png -->
<!-- CAPTION: Recommended VS Code extensions for Deepnote -->

## Updates and Changelog

### Checking for Updates

**Auto-Update:**
- VS Code checks automatically
- Notification appears when update available

**Manual Check:**
1. Go to Extensions view
2. Find Deepnote extension
3. Click "Update" if available

### Release Notes

**View Changelog:**
- Click extension in Extensions view
- Read "Changelog" tab
- Review new features and fixes

## Getting Help

### Resources

- **Documentation:** [docs.deepnote.com](https://docs.deepnote.com)
- **GitHub Issues:** [github.com/deepnote/vscode-deepnote](https://github.com/deepnote/vscode-deepnote)
- **Community:** [community.deepnote.com](https://community.deepnote.com)
- **Support:** support@deepnote.com

### Reporting Issues

**Submit Bug Report:**
1. Go to GitHub Issues
2. Click "New Issue"
3. Provide:
   - VS Code version
   - Extension version
   - Steps to reproduce
   - Error messages
   - Screenshots

### Feature Requests

**Request New Features:**
1. Check existing feature requests
2. Create new issue with "enhancement" label
3. Describe use case and benefits

## Related Documentation

- [Deepnote Projects in VS Code](./vscode-projects.md) - Managing projects
- [Running .deepnote in VS Code](./vscode-running.md) - Execution guide
- [VS Code Supported Blocks](./vscode-supported-blocks.md) - Block types
- [Reading .deepnote Files](./reading-deepnote-files.md) - File format

## Conclusion

The Deepnote VS Code extension brings powerful notebook capabilities to your local development environment. With support for execution, debugging, and rich outputs, you can work efficiently with Deepnote notebooks while leveraging VS Code's powerful editing features.

**Happy coding! 🚀**
