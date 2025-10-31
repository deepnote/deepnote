---
title: Deepnote extension for VS Code, Cursor, and Windsurf
description: Complete guide to the official Deepnote extension for working with Deepnote notebooks locally in VS Code, Cursor, and Windsurf.
noIndex: false
noContent: false
---

# Deepnote extension for VS Code, Cursor, and Windsurf

A powerful extension for [VS Code](https://code.visualstudio.com/), [Cursor](https://cursor.sh/), and [Windsurf](https://windsurf.ai/) that brings Deepnote notebook capabilities directly into your favorite AI-native code editor. Work with slick AI notebooks featuring SQL blocks, database integrations, and reactive blocks.

**Available on:**

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=deepnote.deepnote)
- [Open VSX Registry](https://open-vsx.org/extension/deepnote/deepnote) (for Cursor, Windsurf, and other VS Code compatible editors)
- [GitHub Repository](https://github.com/deepnote/deepnote-vscode)

The Deepnote extension provides:

- **Native `.deepnote` file support** - Open and edit Deepnote notebooks
- **Block execution** - Run code, SQL, and other executable blocks
- **Rich outputs** - Display DataFrames, plots, and visualizations
- **IntelliSense** - Code completion and suggestions
- **Debugging** - Set breakpoints and debug code blocks
- **Git integration** - Version control for notebooks
- **Local execution** - Use your own Python environment

## Installation

### From marketplace

1. **Open your editor**
   - Launch VS Code, Cursor, or Windsurf

2. **Open Extensions View**
   - Click Extensions icon in sidebar (Ctrl/Cmd + Shift + X)
   - Or go to View → Extensions

3. **Search for Deepnote**
   - Type "Deepnote" in the search box
   - Find "Deepnote" by Deepnote

4. **Install**
   - Click "Install" button
   - Wait for installation to complete
   - Reload your editor if prompted

### From command line

```bash
# Install using CLI
code --install-extension deepnote.deepnote  # VS Code
cursor --install-extension deepnote.deepnote  # Cursor
windsurf --install-extension deepnote.deepnote  # Windsurf
```

### Verify installation

1. Open Command Palette (Ctrl/Cmd + Shift + P)
2. Type "Deepnote"
3. You should see Deepnote-related commands

## Features

### Native .deepnote file support

The extension automatically associates `.deepnote` files with the notebook interface, providing YAML syntax highlighting when viewing the raw file and a structured notebook view for editing. You can work in three different view modes: Notebook View for interactive editing and execution, Source View for raw YAML editing, or Split View to see both views side-by-side.

### Block execution

The extension supports executing Python code blocks, SQL blocks with database connections, all types of input blocks, and rendered Markdown blocks. You can run a single block by clicking the play button or pressing Shift + Enter, run all blocks with Ctrl/Cmd + Shift + Enter, or selectively execute all blocks above or below the current one. The extension also provides controls to clear outputs and remove all execution results.

### Rich output display

The extension displays a wide variety of output types including text output from stdout and stderr, interactive DataFrame tables, plots from matplotlib, seaborn, and plotly, images in PNG, JPEG, and SVG formats, HTML content, pretty-printed JSON and dictionaries, and formatted error tracebacks.

### IntelliSense and code completion

The extension provides comprehensive IntelliSense features including auto-completion for Python code, function signatures with documentation, import suggestions, variable inspection, and type hints. IntelliSense triggers automatically as you type and pause, or you can manually invoke it by pressing Ctrl/Cmd + Space.

### Debugging Support

The extension includes full debugging capabilities, allowing you to set breakpoints in code blocks, step through execution, inspect variables, evaluate expressions, and view the call stack. To start debugging, click in the left margin to set a breakpoint, then click the "Debug Cell" button and use the debug controls to step through your code.

### Variable explorer

The Variable Explorer lets you see all variables in the current scope, inspect their values and types, view DataFrame shapes, and expand nested structures. You can access it by clicking "Variables" in the notebook toolbar or using the Command Palette to run "Deepnote: Show Variables".

### Code blocks

Learn more about code blocks in the [Deepnote documentation](https://deepnote.com/docs/blocks-package).

## Configuration

### Extension settings

Access the extension settings by navigating to File → Preferences → Settings (or pressing Ctrl/Cmd + ,) and searching for "Deepnote".

**Available settings:**

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

### Python environment

To select your Python interpreter, open the Command Palette with Ctrl/Cmd + Shift + P, type "Python: Select Interpreter", and choose your preferred Python environment from the list.

For the best experience, we recommend setting up a virtual environment:

```bash
# Create virtual environment
python -m venv .venv

# Activate it
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

# Install dependencies
pip install deepnote-toolkit pandas numpy
```

---

The Deepnote extension brings powerful notebook capabilities to your local development environment, combining the flexibility of Deepnote notebooks with the robust editing features of VS Code, Cursor, and Windsurf. Whether you're executing code, debugging complex logic, or viewing rich outputs, the extension provides a seamless experience that enhances your data science workflow.

**Links:**

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=deepnote.deepnote)
- [Open VSX Registry](https://open-vsx.org/extension/deepnote/deepnote)
- [GitHub Repository](https://github.com/deepnote/deepnote-vscode)
- [Documentation](https://deepnote.com/docs)
- [Report Issues](https://github.com/deepnote/deepnote-vscode/issues)
