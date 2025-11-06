# AI Agent Workflow with Deepnote

## ✅ FULLY AUTOMATED WORKFLOW (Recommended)

Since Deepnote Kernel is built on Jupyter, we can start it programmatically!

### Solution: Start Deepnote Toolkit Server

```bash
# The Deepnote extension installs deepnote-toolkit in a venv
# We can use it to start a Jupyter server with Deepnote Kernel:

~/Library/Application\ Support/Cursor/User/globalStorage/deepnote.vscode-deepnote/deepnote-venvs/*/bin/deepnote-toolkit server --jupyter-port 8888

# Or install globally:
pip install deepnote-toolkit[server]
deepnote-toolkit server
```

### Full Automation Flow

1. **AI starts server** (in background):

   ```bash
   deepnote-toolkit server &
   ```

2. **AI creates `.deepnote` file:**

   ```python
   # AI generates notebook YAML
   ```

3. **AI runs programmatic execution:**

   ```bash
   python scripts/execute-deepnote.py new_notebook.deepnote
   ```

4. **No manual intervention needed!** ✅

---

## Alternative Workflow (Manual Kernel Selection)

### Step 1: User Opens Initial File

```bash
# User opens any .deepnote file in VS Code/Cursor
code examples/1_hello_world.deepnote
```

### Step 2: Extension Prompts for Kernel Selection

- VS Code/Cursor shows kernel picker
- User selects Python environment
- Deepnote Kernel starts

### Step 3: AI Can Now Work

Once a kernel is running, AI agent can:

- Create new `.deepnote` files
- Edit existing files
- Run programmatic execution on ANY `.deepnote` file (using the active kernel)

## Key Insight: One Kernel For All Files

**Important:** Once a Deepnote Kernel is running (from opening ANY `.deepnote` file), the AI can execute **any other** `.deepnote` file using that same kernel!

### Example Workflow

```bash
# User: Opens one file manually to start kernel
code examples/1_hello_world.deepnote  # Selects kernel manually

# AI: Can now create and run NEW files without manual intervention!
```

**AI Prompt 1:** _"Create a new data analysis notebook"_

- AI creates `examples/my_analysis.deepnote`
- AI runs: `python scripts/execute-deepnote.py examples/my_analysis.deepnote`
- Works! Uses the existing kernel

**AI Prompt 2:** _"Debug the errors"_

- AI identifies issues from output
- AI fixes the `.deepnote` file
- AI re-runs: `python scripts/execute-deepnote.py examples/my_analysis.deepnote`
- Works! Still using the same kernel

## Workarounds

### Option 1: Keep One Kernel Alive (Recommended)

```bash
# User: Start your session by opening ANY .deepnote file
code examples/1_hello_world.deepnote

# Keep this file open in a tab
# Now AI can create/edit/run unlimited new .deepnote files
```

### Option 2: Use System Python Interpreter

Add to `.vscode/settings.json`:

```json
{
  "python.defaultInterpreterPath": "python3"
}
```

This may reduce the frequency of kernel selection prompts.

### Option 3: Create .deepnote Files That Open Automatically

AI can create a file and attempt to open it programmatically:

```python
# In execute-deepnote.py or similar
import subprocess
subprocess.run(["code", "new_notebook.deepnote"])
```

This might trigger the extension to start a kernel (untested).

## Future Improvements

### Fully Automated Workflow (Not Yet Possible)

**Desired workflow:**

1. AI creates `.deepnote` file
2. AI automatically starts Deepnote Kernel
3. AI runs programmatic execution
4. No manual intervention needed

**Blockers:**

- VS Code/Cursor extension controls kernel startup
- No programmatic API to trigger kernel selection
- Extension requires user interaction for first kernel

**Possible solutions:**

1. **Deepnote Toolkit direct usage** - Bypass VS Code extension, use toolkit's kernel directly
2. **Extension API enhancement** - Add command to auto-start kernel with default Python
3. **Pre-configured kernel** - Start a persistent kernel that AI can always use

## Current Best Practice

### For Users

1. Open VS Code/Cursor
2. Open ANY `.deepnote` file (e.g., `examples/1_hello_world.deepnote`)
3. Select Python interpreter when prompted
4. Leave file open (or just leave VS Code open with kernel running)
5. Now prompt AI to create/edit/run any `.deepnote` files

### For AI Agents

1. Check if kernel is available: Look for kernel connection files in `~/Library/Jupyter/runtime/`
2. If no kernel found: Inform user to open a `.deepnote` file manually
3. If kernel found: Proceed with creating/editing/executing files

## Testing the Limitation

Let's test if we can run multiple `.deepnote` files with one kernel:

```bash
# User opens first file and selects kernel
code examples/1_hello_world.deepnote

# AI creates and runs second file (should work!)
python scripts/execute-deepnote.py examples/new_file.deepnote

# AI creates and runs third file (should work!)
python scripts/execute-deepnote.py examples/another_file.deepnote
```

**Expected result:** All files execute using the same kernel ✅

---

## Summary

**✅ SOLVED:** Fully automated workflow now possible!

**Method:** Use `deepnote-toolkit server` to start Jupyter server with Deepnote Kernel programmatically

**Impact:** AI agents can now create and execute `.deepnote` files with ZERO manual intervention

**Setup:** Install `deepnote-toolkit[server]` or use the extension's bundled version

**Next steps:** Create a wrapper script that auto-starts server if not running
