# Deepnote Scripts

Utility scripts for working with Deepnote files.

## run-deepnote.sh ✨ NEW - Fully Automated

**Recommended:** Wrapper script that auto-starts Deepnote Toolkit server if needed, then executes the notebook.

### Usage

```bash
# Fully automated - no manual kernel selection needed!
./scripts/run-deepnote.sh examples/1_hello_world.deepnote

# The script will:
# 1. Check if deepnote-toolkit is installed
# 2. Start server if no kernel is running
# 3. Wait for kernel to be ready
# 4. Execute the notebook
```

**Perfect for AI agents** - Zero manual intervention required! 🤖

---

## execute-deepnote.py

Execute all code blocks in a `.deepnote` file programmatically by connecting to a running Deepnote Kernel (Jupyter-compatible kernel with enhanced features).

### Usage

```bash
# Auto-detect the active kernel
python scripts/execute-deepnote.py examples/1_hello_world.deepnote

# Specify kernel explicitly
python scripts/execute-deepnote.py examples/1_hello_world.deepnote fdab3b56-52c0-4070-9936-e459aff26be9
```

**Note:** Requires an active kernel. Use `run-deepnote.sh` for auto-start capability.

### How it works

1. Connects to the running Deepnote Kernel (auto-detected or specified)
2. Parses the `.deepnote` file to extract all blocks (code, SQL, charts, input widgets)
3. Initializes input widget variables in the kernel
4. Auto-generates and installs dependencies from imports
5. Executes blocks in order: init → code → SQL → charts
6. Displays outputs and results in real-time
7. Reports any errors that occur

### Requirements

- A `.deepnote` file must be open in VS Code/Cursor with an active Deepnote Kernel
- The kernel is provided by [deepnote-toolkit](https://github.com/deepnote/deepnote-toolkit) ([PyPI](https://pypi.org/project/deepnote-toolkit/))
- Python packages: `jupyter-client`, `pyyaml` (installed with VS Code/Cursor extension)

### Example Output

```
Auto-detected kernel: fdab3b56-52c0-4070-9936-e459aff26be9

Found 1 code blocks to execute
======================================================================

✓ Connected to kernel fdab3b56-52c0-4070-9936-e459aff26be9

[1/1] Block a0 (15bc86a3):
    print("Hello world!")...
    Output:
      Hello world!

======================================================================
✅ Successfully executed all 1 code blocks!
```

### Features

- ✅ **Auto-detects active kernel** - No need to specify kernel ID
- ✅ **Supports init notebooks** - Executes initialization notebooks first
- ✅ **Auto-generates requirements.txt** - Analyzes imports and creates dependency file
- ✅ **Input widgets** - Initializes all input widget variables before execution
- ✅ **Real-time output** - Displays results as code executes
- ✅ **Error reporting** - Shows which blocks failed and why

### Use Cases

- **CI/CD pipelines**: Run notebooks as part of automated testing
- **Batch processing**: Execute multiple notebooks programmatically
- **AI agents**: Allow AI assistants to execute notebook code
- **Debugging**: Run specific notebooks without opening the UI
- **Testing**: Verify notebook execution succeeds

### Supported Block Types

✅ **Code blocks** - Fully supported  
✅ **Input widgets** - All types supported:

- `input-text` - Text inputs
- `input-textarea` - Multi-line text
- `input-select` - Dropdown selections
- `input-slider` - Numeric sliders
- `input-checkbox` - Boolean checkboxes
- `input-date` - Date pickers
- `input-date-range` - Date range pickers

✅ **SQL blocks** - Supported for:

- **Pandas DataFrames** (DuckDB) - Query in-memory DataFrames with SQL!
- ClickHouse (e.g., ClickHouse playground)
- PostgreSQL
- MySQL/MariaDB
- More databases coming soon!

✅ **Chart blocks** - Full support!

- Code-based charts (matplotlib, seaborn, plotly) ✅ Fully working
- No-code chart blocks (Deepnote visual builder) ✅ Fully working
- All chart types supported (bar, line, scatter, pie, donut, area, etc.)

### Limitations

- **Requires active Deepnote Kernel** - Must have a `.deepnote` file open in VS Code/Cursor (cannot create new kernels automatically)
- **SQL blocks** - External databases need credentials (ClickHouse playground is free!)
- **Terminal output** - Text-only display (no rich HTML/images in terminal)
- **Input widgets** - Values taken from file (not interactive during execution)
