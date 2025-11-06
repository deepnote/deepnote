# Deepnote Scripts

Utility scripts for working with Deepnote files.

## execute-deepnote.py

Execute all code blocks in a `.deepnote` file programmatically by connecting to a running Jupyter kernel.

### Usage

```bash
# Auto-detect the active kernel
python scripts/execute-deepnote.py examples/1_hello_world.deepnote

# Specify kernel explicitly
python scripts/execute-deepnote.py examples/1_hello_world.deepnote fdab3b56-52c0-4070-9936-e459aff26be9
```

### How it works

1. Connects to the running Jupyter kernel (auto-detected or specified)
2. Parses the `.deepnote` file to extract all code blocks
3. Executes each code block in sequence
4. Displays outputs and results in real-time
5. Reports any errors that occur

### Requirements

- A `.deepnote` file must be open in VS Code/Cursor with an active kernel
- The `jupyter-client` and `pyyaml` packages must be installed

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

⚠️ **SQL blocks** - Not yet supported (requires database integration)  
⚠️ **Chart blocks** - Not yet supported

### Limitations

- Requires an active Deepnote kernel (a wrapper around Jupyter kernel; cannot create new kernels automatically)
- Cannot execute SQL blocks yet (needs database connections)
- Outputs are text-only in terminal (no rich HTML/images displayed)
- Input widget values are taken from the file (not interactive)
