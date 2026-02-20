# @deepnote/cli

Command-line interface for running Deepnote projects locally and on Deepnote Cloud.

> **Note:** This project is under active development and is not ready for production use. Expect breaking changes.

## Installation

```bash
npm install -g @deepnote/cli
# or
pnpm add -g @deepnote/cli
# or
yarn global add @deepnote/cli
```

## Quick Start

```bash
# Show help
deepnote --help

# Show version
deepnote --version

# Run a project/notebook file (.deepnote, .ipynb, .py, .qmd)
deepnote run path/to/file.deepnote

# Inspect a .deepnote file
deepnote inspect path/to/file.deepnote

# Display block contents
deepnote cat my-project.deepnote

# Check for issues
deepnote lint my-project.deepnote

# Show project statistics
deepnote stats my-project.deepnote

# Validate a .deepnote file
deepnote validate path/to/file.deepnote

# Convert between notebook formats
deepnote convert notebook.ipynb
```

## Commands

### `inspect [path]`

Inspect and display metadata from a `.deepnote` file.
Path is optional: when omitted, the CLI discovers the first `.deepnote` file in the current directory.

```bash
deepnote inspect my-project.deepnote
```

**Output includes:**

- File path and project name
- Project ID and file format version
- Creation, modification, and export timestamps
- Number of notebooks and blocks
- List of notebooks with their block counts

**Options:**

| Option               | Description                             | Default |
| -------------------- | --------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `toon`, or `llm` | text    |

**Examples:**

```bash
# Basic inspection
deepnote inspect my-project.deepnote

# Inspect first .deepnote file in current directory
deepnote inspect

# JSON output for scripting
deepnote inspect my-project.deepnote --output json

# TOON output for LLM consumption (30-60% fewer tokens)
deepnote inspect my-project.deepnote --output toon

# Use with jq to extract specific fields
deepnote inspect my-project.deepnote --output json | jq '.project.name'
```

### `cat <path>`

Display block contents from a `.deepnote` file, with optional filtering by notebook, block type, or tree view.

```bash
deepnote cat my-project.deepnote
```

**Options:**

| Option               | Description                                                       | Default |
| -------------------- | ----------------------------------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`                                    | text    |
| `--notebook <name>`  | Show only blocks from the specified notebook                      |         |
| `--type <type>`      | Filter blocks by type: `code`, `sql`, `markdown`, `text`, `input` |         |
| `--tree`             | Show structure only without block content                         | `false` |

**Examples:**

```bash
# Display all blocks in a file
deepnote cat my-project.deepnote

# Show only code blocks
deepnote cat my-project.deepnote --type code

# Show blocks from a specific notebook
deepnote cat my-project.deepnote --notebook "Data Analysis"

# Show structure without content (tree view)
deepnote cat my-project.deepnote --tree

# Output as JSON for scripting
deepnote cat my-project.deepnote -o json
```

### `run [path]`

Run a project/notebook file locally. Supported formats: `.deepnote`, `.ipynb`, `.py`, `.qmd`.
Path is optional: when omitted, the CLI discovers the first `.deepnote` file in the current directory.

```bash
deepnote run my-project.deepnote
```

**Options:**

| Option                  | Description                                                      | Default        |
| ----------------------- | ---------------------------------------------------------------- | -------------- |
| `--python <path>`       | Path to Python interpreter or virtual environment                | auto-detected  |
| `--cwd <path>`          | Working directory for execution                                  | file directory |
| `--notebook <name>`     | Run only the specified notebook                                  | all notebooks  |
| `--block <id>`          | Run only the specified block                                     | all blocks     |
| `-i, --input <key=val>` | Set input variable value (can be repeated)                       |                |
| `--list-inputs`         | List input variables without running                             | `false`        |
| `-o, --output <fmt>`    | Output format: `json`, `toon`, or `llm`                          | text           |
| `--dry-run`             | Show execution plan without running                              | `false`        |
| `--top`                 | Display resource usage (CPU/memory) during execution             | `false`        |
| `--profile`             | Show per-block timing and memory summary                         | `false`        |
| `--open`                | Open project in Deepnote Cloud after successful execution        | `false`        |
| `--context`             | Include analysis context in output (requires `-o json/toon/llm`) | `false`        |

**Examples:**

```bash
# Run all notebooks
deepnote run my-project.deepnote

# Run a Jupyter notebook directly (auto-converted)
deepnote run notebook.ipynb

# Run with a specific Python virtual environment
deepnote run my-project.deepnote --python path/to/venv

# Run only a specific notebook
deepnote run my-project.deepnote --notebook "Data Analysis"

# Set input values for input blocks
deepnote run my-project.deepnote --input name="Alice" --input count=42

# Output results as JSON for CI/CD pipelines
deepnote run my-project.deepnote --output json

# Output results as TOON for LLM consumption
deepnote run my-project.deepnote --output toon

# Preview what would be executed without running
deepnote run my-project.deepnote --dry-run
```

### `lint <path>`

Check a `.deepnote` file for issues including undefined variables, circular dependencies, unused/shadowed variables, missing integrations, and missing inputs.

```bash
deepnote lint my-project.deepnote
```

**Checks:**

- **undefined-variable** - Variables used but never defined
- **circular-dependency** - Blocks with circular dependencies
- **unused-variable** - Variables defined but never used
- **shadowed-variable** - Variables that shadow previous definitions
- **parse-error** - Blocks that failed to parse
- **missing-integration** - SQL blocks using integrations that are not configured
- **missing-input** - Input blocks without default values

**Options:**

| Option               | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm` | text    |
| `--notebook <name>`  | Lint only a specific notebook  |         |
| `--python <path>`    | Path to Python interpreter     |         |

**Exit codes:** `0` = no errors (warnings may be present), `1` = errors found, `2` = invalid usage.

**Examples:**

```bash
# Lint a .deepnote file
deepnote lint my-project.deepnote

# Output as JSON for CI/CD
deepnote lint my-project.deepnote -o json

# Use in CI pipeline
deepnote lint my-project.deepnote || exit 1
```

### `stats <path>`

Show statistics about a `.deepnote` file including block counts, lines of code, and imported modules.

```bash
deepnote stats my-project.deepnote
```

**Options:**

| Option               | Description                        | Default |
| -------------------- | ---------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`     | text    |
| `--notebook <name>`  | Show stats for a specific notebook |         |

**Examples:**

```bash
# Show project statistics
deepnote stats my-project.deepnote

# Output as JSON for scripting
deepnote stats my-project.deepnote -o json

# Show stats for a specific notebook
deepnote stats my-project.deepnote --notebook "Data Analysis"
```

### `analyze <path>`

Comprehensive project analysis combining quality scoring, structure analysis, dependency checks, and actionable suggestions.

```bash
deepnote analyze my-project.deepnote
```

**Options:**

| Option               | Description                             | Default |
| -------------------- | --------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `toon`, or `llm` | text    |
| `--notebook <name>`  | Analyze only a specific notebook        |         |
| `--python <path>`    | Path to Python interpreter              |         |

**Examples:**

```bash
# Analyze a project
deepnote analyze my-project.deepnote

# Output for LLM consumption
deepnote analyze my-project.deepnote -o toon
```

### `dag <subcommand> <path>`

Analyze block dependencies and variable flow.

**Subcommands:**

| Subcommand   | Description                                     |
| ------------ | ----------------------------------------------- |
| `show`       | Show the dependency graph between blocks        |
| `vars`       | List variables defined and used by each block   |
| `downstream` | Show blocks that need re-run if a block changes |

**Options (shared):**

| Option               | Description                              | Default |
| -------------------- | ---------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json`, `dot`\*, or `llm` | text    |
| `--notebook <name>`  | Analyze only a specific notebook         |         |
| `--python <path>`    | Path to Python interpreter               |         |

\* `dot` format is only supported by `dag show`.

The `downstream` subcommand also requires `-b, --block <id>` to specify the block to analyze.

**Examples:**

```bash
# Show the dependency graph
deepnote dag show my-project.deepnote

# List variables for each block
deepnote dag vars my-project.deepnote

# Show what needs re-run if a block changes
deepnote dag downstream my-project.deepnote --block "Load Data"

# Generate Graphviz visualization
deepnote dag show my-project.deepnote -o dot | dot -Tpng -o deps.png
```

### `diff <path1> <path2>`

Compare two `.deepnote` files and show structural differences.

```bash
deepnote diff original.deepnote modified.deepnote
```

**Options:**

| Option               | Description                           | Default |
| -------------------- | ------------------------------------- | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`        | text    |
| `--content`          | Include content differences in output | `false` |

**Examples:**

```bash
# Compare two .deepnote files
deepnote diff original.deepnote modified.deepnote

# Compare with content differences
deepnote diff file1.deepnote file2.deepnote --content

# Output as JSON for scripting
deepnote diff file1.deepnote file2.deepnote -o json
```

### `convert <path>`

Convert between notebook formats.

```bash
deepnote convert notebook.ipynb
```

**Supported conversions:**

- **To Deepnote:** `.ipynb`, `.qmd`, `.py` → `.deepnote`
- **From Deepnote:** `.deepnote` → `.ipynb`, `.qmd`, `.py` (percent/marimo)

**Options:**

| Option                | Description                                                              | Default   |
| --------------------- | ------------------------------------------------------------------------ | --------- |
| `-o, --output <path>` | Output path (file or directory)                                          |           |
| `-n, --name <name>`   | Project name (for conversions to `.deepnote`)                            |           |
| `-f, --format <fmt>`  | Output format from `.deepnote`: `jupyter`, `percent`, `quarto`, `marimo` | `jupyter` |
| `--open`              | Open the converted `.deepnote` file in Deepnote Cloud                    | `false`   |

**Examples:**

```bash
# Convert Jupyter notebook to Deepnote
deepnote convert notebook.ipynb

# Convert and open in Deepnote Cloud
deepnote convert notebook.ipynb --open

# Convert directory of notebooks
deepnote convert ./notebooks/

# Convert Deepnote to Jupyter
deepnote convert project.deepnote

# Convert Deepnote to Quarto
deepnote convert project.deepnote -f quarto

# Convert Deepnote to Marimo
deepnote convert project.deepnote -f marimo
```

### `open <path>`

Open a `.deepnote` file in Deepnote Cloud by uploading it and opening the URL in your default browser.

> **Note:** Files must be under 100 MB.

```bash
deepnote open my-project.deepnote
```

**Options:**

| Option               | Description                                   | Default        |
| -------------------- | --------------------------------------------- | -------------- |
| `-o, --output <fmt>` | Output format: `json` or `llm`                | text           |
| `--domain <domain>`  | Deepnote domain (for single-tenant instances) | `deepnote.com` |

**Examples:**

```bash
# Open a .deepnote file in Deepnote
deepnote open my-project.deepnote

# Open with JSON output (for scripting)
deepnote open my-project.deepnote -o json
```

### `validate <path>`

Validate a `.deepnote` file against the schema.

```bash
deepnote validate my-project.deepnote
```

**Options:**

| Option               | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `-o, --output <fmt>` | Output format: `json` or `llm` | text    |

**Examples:**

```bash
# Validate a file
deepnote validate my-project.deepnote

# JSON output for CI/CD pipelines
deepnote validate my-project.deepnote --output json
```

### `integrations pull`

Pull database integrations from the Deepnote API and merge with a local integrations file.

```bash
deepnote integrations pull
```

**Options:**

| Option              | Description                                    | Default             |
| ------------------- | ---------------------------------------------- | ------------------- |
| `--url <url>`       | API base URL                                   | Deepnote API        |
| `--token <token>`   | Bearer token (or use `DEEPNOTE_TOKEN` env var) |                     |
| `--file <path>`     | Path to integrations file                      | `integrations.yaml` |
| `--env-file <path>` | Path to `.env` file for storing secrets        | `.env`              |

**Examples:**

```bash
# Pull integrations from Deepnote API
deepnote integrations pull

# Pull with a specific token
deepnote integrations pull --token <token>

# Pull to a custom file path
deepnote integrations pull --file my-integrations.yaml
```

### `completion <shell>`

Generate shell completion scripts for tab completion.

**Supported shells:** `bash`, `zsh`, `fish`

**Installation:**

```bash
# Bash (add to ~/.bashrc or ~/.bash_profile)
deepnote completion bash >> ~/.bashrc
source ~/.bashrc

# Zsh (add to ~/.zshrc)
deepnote completion zsh >> ~/.zshrc
source ~/.zshrc

# Fish (save to completions directory)
deepnote completion fish > ~/.config/fish/completions/deepnote.fish
```

### `install-skills`

Install the Deepnote skill for AI coding assistants (Claude Code, Cursor, Windsurf, etc.). The skill gives your AI assistant knowledge of the `.deepnote` file format, CLI commands, and block types.

```bash
deepnote install-skills
```

**Options:**

| Option                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `-g, --global`        | Install to your home directory instead of project   |
| `-a, --agent <agent>` | Target a specific agent (e.g. `cursor`, `windsurf`) |
| `--dry-run`           | Preview what would be installed without writing     |

**Supported agents:** Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, Roo Code, Augment, Continue, Antigravity, Trae, Goose, Junie, Kilo Code, Kiro, Codex, Gemini CLI, Amp, Kimi Code CLI, OpenCode.

**Examples:**

```bash
# Install for all detected agents in the current project
deepnote install-skills

# Install globally (available across all projects)
deepnote install-skills --global

# Install for a specific agent
deepnote install-skills --agent cursor
deepnote install-skills --agent "github copilot"
deepnote install-skills --agent windsurf

# Preview without writing files
deepnote install-skills --dry-run
```

## Global Options

These options work with all commands:

| Option          | Description                                        |
| --------------- | -------------------------------------------------- |
| `-h, --help`    | Display help information                           |
| `-v, --version` | Display the CLI version                            |
| `--no-color`    | Disable colored output                             |
| `--debug`       | Show debug information for troubleshooting         |
| `-q, --quiet`   | Suppress non-essential output (errors still shown) |

## Environment Variables

| Variable      | Description                                |
| ------------- | ------------------------------------------ |
| `NO_COLOR`    | Set to any value to disable colored output |
| `FORCE_COLOR` | Set to `1` to force colors, `0` to disable |

The CLI follows the [NO_COLOR](https://no-color.org/) and [FORCE_COLOR](https://force-color.org/) standards.

## Exit Codes

The CLI uses standard exit codes for scripting:

| Code | Name          | Description                                   |
| ---- | ------------- | --------------------------------------------- |
| `0`  | Success       | Command completed successfully                |
| `1`  | Error         | General error (runtime failures)              |
| `2`  | Invalid Usage | Invalid arguments, file not found, wrong type |

**Example usage in scripts:**

```bash
#!/bin/bash
if deepnote inspect project.deepnote --output json > /dev/null 2>&1; then
    echo "Valid .deepnote file"
else
    exit_code=$?
    if [ $exit_code -eq 2 ]; then
        echo "Invalid file or arguments"
    else
        echo "Unexpected error"
    fi
fi
```

## Output Formats

The CLI supports output formats via the `-o, --output` option:

| Format | Description                                                                             |
| ------ | --------------------------------------------------------------------------------------- |
| `json` | Standard JSON format for scripting and CI/CD pipelines                                  |
| `toon` | [TOON format](https://toonformat.dev/) - LLM-optimized, 30-60% fewer tokens             |
| `llm`  | Alias to the best LLM format for each command (`toon` when available, otherwise `json`) |

## JSON Output Schema

### `inspect --output json`

```typescript
interface InspectOutput {
  success: true;
  path: string;
  project: {
    name: string;
    id: string;
  };
  version: string;
  metadata: {
    createdAt: string;
    modifiedAt: string | null;
    exportedAt: string | null;
  };
  statistics: {
    notebookCount: number;
    totalBlocks: number;
  };
  notebooks: Array<{
    name: string;
    blockCount: number;
    isModule: boolean;
  }>;
}

// On error:
interface InspectError {
  success: false;
  error: string;
}
```

### `run --output json`

```typescript
interface RunOutput {
  success: boolean;
  path: string;
  executedBlocks: number;
  totalBlocks: number;
  failedBlocks: number;
  totalDurationMs: number;
  blocks: Array<{
    id: string;
    type: string;
    label: string;
    success: boolean;
    durationMs: number;
    outputs: Array<{
      output_type: "stream" | "execute_result" | "display_data" | "error";
      // For stream outputs:
      name?: "stdout" | "stderr";
      text?: string;
      // For execute_result/display_data:
      data?: Record<string, unknown>;
      // For error outputs:
      ename?: string;
      evalue?: string;
      traceback?: string[];
    }>;
    error?: string;
  }>;
}

// On error before execution starts:
interface RunError {
  success: false;
  error: string;
}
```

### `validate --output json`

```typescript
// When validation runs (file found and readable):
interface ValidationResult {
  success: true;
  path: string;
  valid: boolean;
  issues: Array<{
    path: string; // JSON path to the invalid field (e.g., "notebooks.0.blocks.1")
    message: string;
    code: string; // Zod error code (e.g., "invalid_type", "unrecognized_keys")
  }>;
}

// On error (file not found, resolution error, or runtime failure):
interface ValidationError {
  success: false;
  error: string;
}
```

The `success` field indicates whether the command completed:

- `success: true` - validation ran, check `valid` for the result
- `success: false` - operational error (file not found, etc.)

## Programmatic Usage

The CLI can also be used programmatically:

```typescript
import { createProgram, run, ExitCode } from "@deepnote/cli";

// Run with custom arguments
run(["node", "deepnote", "inspect", "project.deepnote"]);

// Or create and configure the program manually
const program = createProgram();
program.parse([
  "node",
  "deepnote",
  "inspect",
  "project.deepnote",
  "--output",
  "json",
]);
```

## Error Messages

The CLI provides helpful error messages with suggestions:

```bash
$ deepnote inspect missing-file.deepnote
# Error: File not found: /path/to/missing-file.deepnote
#
# Did you mean?
#   - my-project.deepnote
#   - another-project.deepnote

$ deepnote inspect notebook.ipynb
# Error: Unsupported file type: .ipynb
#
# Jupyter notebooks (.ipynb) are not directly supported.
# Use the @deepnote/convert package to convert to .deepnote format.
```

## Related Packages

- [`@deepnote/blocks`](../blocks) - Core package for working with Deepnote blocks
- [`@deepnote/convert`](../convert) - Convert between Jupyter and Deepnote formats
- [`@deepnote/runtime-core`](../runtime-core) - Runtime engine for executing notebooks

## License

Apache-2.0
