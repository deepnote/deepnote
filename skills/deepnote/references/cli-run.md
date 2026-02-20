# CLI: Run Command

Install: `npm install -g @deepnote/cli`

## `deepnote run [path]`

Execute notebooks (.deepnote, .ipynb, .py, .qmd).

| Option                    | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `--python <path>`         | Path to Python (executable, bin directory, or venv root) |
| `--cwd <path>`            | Working directory for execution                          |
| `--notebook <name>`       | Run only the specified notebook                          |
| `--block <id>`            | Run only the specified block                             |
| `-i, --input <key=value>` | Set input variable value (repeatable)                    |
| `--list-inputs`           | List all input variables without running                 |
| `-o, --output <format>`   | Output format: `json`, `toon`, `llm`                     |
| `--dry-run`               | Show what would be executed without running              |
| `--top`                   | Display resource usage (CPU, memory) during execution    |
| `--profile`               | Show per-block timing and memory usage                   |
| `--open`                  | Open the project in Deepnote Cloud after execution       |
| `--context`               | Include analysis context in output                       |

**Examples:**

```bash
# Run a Jupyter notebook (auto-converts)
deepnote run notebook.ipynb

# Run with a specific Python venv
deepnote run my-project.deepnote --python path/to/venv

# Run a specific notebook within a project
deepnote run my-project.deepnote --notebook "Data Analysis"

# Run a specific block
deepnote run my-project.deepnote --block abc123

# Set input values
deepnote run my-project.deepnote --input name="Alice" --input count=42

# Preview without running
deepnote run my-project.deepnote --dry-run

# Profile execution
deepnote run my-project.deepnote --profile

# Run and open in Deepnote Cloud
deepnote run notebook.ipynb --open
```

**Exit codes:** 0 = success, 1 = runtime error, 2 = invalid usage.
