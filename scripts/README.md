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

### Use Cases

- **CI/CD pipelines**: Run notebooks as part of automated testing
- **Batch processing**: Execute multiple notebooks programmatically
- **AI agents**: Allow AI assistants to execute notebook code
- **Debugging**: Run specific notebooks without opening the UI
- **Testing**: Verify notebook execution succeeds

### Limitations

- Only executes code blocks (not SQL, input widgets, etc. yet)
- Requires an active Jupyter kernel
- Cannot create new kernels automatically
- Outputs are text-only (no rich HTML/images displayed)
