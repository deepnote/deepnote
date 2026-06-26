# CLI: Utility Commands

Install: `npm install -g @deepnote/cli`

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

## `deepnote split <path>`

Split a multi-notebook `.deepnote` file into separate single-notebook files.

The init notebook (if present) becomes its own standalone file, and each resulting main file keeps its `initNotebookId` so a full `deepnote run` resolves and runs the sibling init notebook as a prelude before the file's own blocks. Filtered runs (`deepnote run --notebook <name>` or `--block <id>`) execute only the selected blocks and do **not** run the sibling init prelude.

| Option               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `-o, --output <dir>` | Output directory for split files (default: same directory as input) |
| `--force`            | Overwrite existing output files                                     |

**Examples:**

```bash
# Split into the same directory as the input
deepnote split my-project.deepnote

# Split into a specific output directory
deepnote split my-project.deepnote -o ./notebooks/

# Overwrite existing output files
deepnote split my-project.deepnote --force
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

## `deepnote install-skills`

Install Deepnote agent skills for AI coding assistants.

| Option                | Description                             |
| --------------------- | --------------------------------------- |
| `-g, --global`        | Install to user home instead of project |
| `-a, --agent <agent>` | Target a specific agent                 |
| `--dry-run`           | Preview without writing files           |

**Examples:**

```bash
# Install for detected agents
deepnote install-skills

# Install globally
deepnote install-skills --global

# Target specific agent
deepnote install-skills --agent cursor
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
