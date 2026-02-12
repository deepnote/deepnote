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

# Inspect a .deepnote file
deepnote inspect path/to/file.deepnote

# Inspect with JSON output (for scripting)
deepnote inspect path/to/file.deepnote --output json

# Inspect with TOON output (for LLMs, 30-60% fewer tokens)
deepnote inspect path/to/file.deepnote --output toon

# Validate a .deepnote file
deepnote validate path/to/file.deepnote

# Run a project/notebook file (.deepnote, .ipynb, .py, .qmd)
deepnote run path/to/file.deepnote
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

### `run [path]`

Run a project/notebook file locally. Supported formats: `.deepnote`, `.ipynb`, `.py`, `.qmd`.
Path is optional: when omitted, the CLI discovers the first `.deepnote` file in the current directory.

```bash
deepnote run my-project.deepnote
```

**Options:**

| Option                  | Description                                               | Default        |
| ----------------------- | --------------------------------------------------------- | -------------- |
| `--python <path>`       | Path to Python interpreter or virtual environment         | auto-detected  |
| `--cwd <path>`          | Working directory for execution                           | file directory |
| `--notebook <name>`     | Run only the specified notebook                           | all notebooks  |
| `--block <id>`          | Run only the specified block                              | all blocks     |
| `-i, --input <key=val>` | Set input variable value (can be repeated)                |                |
| `--list-inputs`         | List input variables without running                      | `false`        |
| `-o, --output <fmt>`    | Output format: `json`, `toon`, or `llm`                   | text           |
| `--dry-run`             | Show execution plan without running                       | `false`        |
| `--top`                 | Display resource usage (CPU/memory) during execution      | `false`        |
| `--profile`             | Show per-block timing and memory summary                  | `false`        |
| `--open`                | Open project in Deepnote Cloud after successful execution | `false`        |
| `--context`             | Include analysis context in machine-readable output       | `false`        |

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

# Output results as JSON for CI/CD pipelines
deepnote run my-project.deepnote --output json

# Output results as TOON for LLM consumption
deepnote run my-project.deepnote --output toon
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
