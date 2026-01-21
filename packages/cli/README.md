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
deepnote inspect path/to/file.deepnote --json

# Run a .deepnote file
deepnote run path/to/file.deepnote
```

## Commands

### `inspect <path>`

Inspect and display metadata from a `.deepnote` file.

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

| Option   | Description                         |
| -------- | ----------------------------------- |
| `--json` | Output in JSON format for scripting |

**Examples:**

```bash
# Basic inspection
deepnote inspect my-project.deepnote

# JSON output for scripting
deepnote inspect my-project.deepnote --json

# Use with jq to extract specific fields
deepnote inspect my-project.deepnote --json | jq '.project.name'
```

### `run <path>`

Run a `.deepnote` file locally.

```bash
deepnote run my-project.deepnote
```

**Options:**

| Option              | Description                                            | Default  |
| ------------------- | ------------------------------------------------------ | -------- |
| `--python <path>`   | Path to Python interpreter                             | `python` |
| `--cwd <path>`      | Working directory for execution (defaults to file dir) |          |
| `--notebook <name>` | Run only the specified notebook                        |          |
| `--block <id>`      | Run only the specified block                           |          |
| `--json`            | Output results in JSON format                          |          |

**Examples:**

```bash
# Run all notebooks
deepnote run my-project.deepnote

# Run with a specific Python interpreter
deepnote run my-project.deepnote --python python3.11

# Run only a specific notebook
deepnote run my-project.deepnote --notebook "Data Analysis"

# Output results as JSON for CI/CD pipelines
deepnote run my-project.deepnote --json
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
if deepnote inspect project.deepnote --json > /dev/null 2>&1; then
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

## JSON Output Schema

### `inspect --json`

```typescript
interface InspectOutput {
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
```

### `run --json`

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

## Programmatic Usage

The CLI can also be used programmatically:

```typescript
import { createProgram, run, ExitCode } from "@deepnote/cli";

// Run with custom arguments
run(["node", "deepnote", "inspect", "project.deepnote"]);

// Or create and configure the program manually
const program = createProgram();
program.parse(["node", "deepnote", "inspect", "project.deepnote", "--json"]);
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
