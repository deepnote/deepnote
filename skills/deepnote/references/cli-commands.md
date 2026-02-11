# CLI Commands Reference

Install: `npm install -g @deepnote/cli`

All commands support `--help` for detailed usage.

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

## `deepnote convert <path>`

Convert between notebook formats.

| Option                  | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `-o, --output <path>`   | Output path (file or directory)                                                             |
| `-n, --name <name>`     | Project name (for conversions to .deepnote)                                                 |
| `-f, --format <format>` | Output format from .deepnote: `jupyter`, `percent`, `quarto`, `marimo` (default: `jupyter`) |
| `--open`                | Open converted .deepnote file in Deepnote Cloud                                             |

**Supported conversions:**

- **To .deepnote:** `.ipynb`, `.qmd`, `.py` (percent or Marimo)
- **From .deepnote:** `.ipynb`, `.qmd`, `.py` (percent or Marimo)

**Examples:**

```bash
# Convert Jupyter to Deepnote
deepnote convert notebook.ipynb

# Convert with custom output
deepnote convert notebook.ipynb -o my-project.deepnote

# Convert directory of notebooks
deepnote convert ./notebooks/

# Convert Deepnote to Quarto
deepnote convert project.deepnote -f quarto

# Convert Deepnote to Marimo
deepnote convert project.deepnote -f marimo
```

## `deepnote inspect [path]`

Display structured metadata about a .deepnote file.

| Option                  | Description                          |
| ----------------------- | ------------------------------------ |
| `-o, --output <format>` | Output format: `json`, `toon`, `llm` |

Smart file discovery: if no path is given, finds the first `.deepnote` file in the current directory.

**Examples:**

```bash
deepnote inspect my-project.deepnote
deepnote inspect my-project.deepnote -o json
deepnote inspect  # auto-discover in current directory
```

## `deepnote cat <path>`

Display block contents from a .deepnote file.

| Option                  | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`                                     |
| `--notebook <name>`     | Show only blocks from specified notebook                         |
| `--type <type>`         | Filter by block type: `code`, `sql`, `markdown`, `text`, `input` |
| `--tree`                | Show structure only without content                              |

**Examples:**

```bash
# Show all blocks
deepnote cat my-project.deepnote

# Show only code blocks
deepnote cat my-project.deepnote --type code

# Show only blocks from a specific notebook
deepnote cat my-project.deepnote --notebook "Analysis"

# Tree view (structure without content)
deepnote cat my-project.deepnote --tree

# Combine filters
deepnote cat my-project.deepnote --notebook "Analysis" --type sql
```

## `deepnote diff <path1> <path2>`

Compare two .deepnote files and show structural differences.

| Option                  | Description                           |
| ----------------------- | ------------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`          |
| `--content`             | Include content differences in output |

**Examples:**

```bash
deepnote diff original.deepnote modified.deepnote
deepnote diff file1.deepnote file2.deepnote --content
deepnote diff current.deepnote backup.snapshot.deepnote
```

## `deepnote validate <path>`

Validate a .deepnote file against the schema.

| Option                  | Description                  |
| ----------------------- | ---------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm` |

**Exit codes:** 0 = valid, 1 = invalid, 2 = invalid usage.

**Examples:**

```bash
deepnote validate my-project.deepnote
deepnote validate my-project.deepnote -o json
deepnote validate my-project.deepnote && echo "Valid!"
```

## `deepnote lint <path>`

Check a .deepnote file for issues.

| Option                  | Description                   |
| ----------------------- | ----------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`  |
| `--notebook <name>`     | Lint only a specific notebook |
| `--python <path>`       | Path to Python interpreter    |

**Checks performed:**

- **Variables:** undefined, circular dependencies, unused, shadowed, parse errors
- **Integrations:** SQL blocks using missing integrations
- **Inputs:** Input blocks without default values

**Exit codes:** 0 = no errors (warnings OK), 1 = errors found, 2 = invalid usage.

**Examples:**

```bash
deepnote lint my-project.deepnote
deepnote lint my-project.deepnote -o json
deepnote lint my-project.deepnote --notebook "Analysis"
```

## `deepnote stats <path>`

Show statistics about a .deepnote file.

| Option                  | Description                          |
| ----------------------- | ------------------------------------ |
| `-o, --output <format>` | Output format: `json`, `toon`, `llm` |
| `--notebook <name>`     | Analyze only a specific notebook     |

**Examples:**

```bash
deepnote stats my-project.deepnote
deepnote stats my-project.deepnote -o json
```

## `deepnote analyze <path>`

Comprehensive analysis with quality score (0-100).

| Option                  | Description                          |
| ----------------------- | ------------------------------------ |
| `-o, --output <format>` | Output format: `json`, `toon`, `llm` |
| `--notebook <name>`     | Analyze only a specific notebook     |
| `--python <path>`       | Path to Python interpreter           |

**Examples:**

```bash
deepnote analyze my-project.deepnote
deepnote analyze my-project.deepnote -o toon
```

## `deepnote dag`

Dependency analysis subcommands.

### `deepnote dag show <path>`

Show the dependency graph between blocks.

| Option                  | Description                         |
| ----------------------- | ----------------------------------- |
| `-o, --output <format>` | Output format: `json`, `dot`, `llm` |
| `--notebook <name>`     | Analyze only a specific notebook    |
| `--python <path>`       | Path to Python interpreter          |

```bash
deepnote dag show my-project.deepnote
deepnote dag show my-project.deepnote -o dot | dot -Tpng -o deps.png
```

### `deepnote dag vars <path>`

List variables defined and used by each block.

| Option                  | Description                      |
| ----------------------- | -------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`     |
| `--notebook <name>`     | Analyze only a specific notebook |
| `--python <path>`       | Path to Python interpreter       |

```bash
deepnote dag vars my-project.deepnote
```

### `deepnote dag downstream <path>`

Show blocks that need re-run if a block changes.

| Option                  | Description                             |
| ----------------------- | --------------------------------------- |
| `-b, --block <id>`      | Block ID or label to analyze (required) |
| `-o, --output <format>` | Output format: `json`, `llm`            |
| `--notebook <name>`     | Analyze only a specific notebook        |
| `--python <path>`       | Path to Python interpreter              |

```bash
deepnote dag downstream my-project.deepnote --block "Load Data"
```

## `deepnote open <path>`

Upload and open a .deepnote file in Deepnote Cloud.

| Option                  | Description                               |
| ----------------------- | ----------------------------------------- |
| `--domain <domain>`     | Deepnote domain (default: `deepnote.com`) |
| `-o, --output <format>` | Output format: `json`, `llm`              |

**Examples:**

```bash
deepnote open my-project.deepnote
deepnote open my-project.deepnote -o json
```

## `deepnote completion <shell>`

Generate shell completion scripts.

Supported shells: `bash`, `zsh`, `fish`.

```bash
# Install for bash
deepnote completion bash >> ~/.bashrc

# Install for zsh
deepnote completion zsh >> ~/.zshrc

# Install for fish
deepnote completion fish > ~/.config/fish/completions/deepnote.fish
```

## Global Options

All commands support:

| Option                   | Description                   |
| ------------------------ | ----------------------------- |
| `--color` / `--no-color` | Force/disable colored output  |
| `--debug`                | Show debug output             |
| `--quiet`                | Suppress non-essential output |
| `--version`              | Show CLI version              |
| `--help`                 | Show help                     |

**Environment variables:**

| Variable      | Description                                |
| ------------- | ------------------------------------------ |
| `NO_COLOR`    | Disable colored output (any value)         |
| `FORCE_COLOR` | Set to `1` to force colors, `0` to disable |
