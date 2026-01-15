# @deepnote/cli

Command-line interface for running Deepnote projects locally and on Deepnote Cloud.

This project is under active development and is not ready for use. Expect breaking changes.

## Quick Start

```bash
# Show help
deepnote --help

# Show version
deepnote --version

# Inspect a .deepnote file
deepnote inspect path/to/file.deepnote
```

## Commands

### `inspect <path>`

Inspect and display metadata from a `.deepnote` file.

```bash
deepnote inspect my-project.deepnote
```

This command displays:

- File path
- Project name and ID
- File format version
- Creation, modification, and export timestamps
- Number of notebooks and blocks
- List of notebooks with their block counts

## Development

```bash
# Install dependencies (from repo root)
pnpm install

# Build the CLI
pnpm build

# Run the CLI in development mode (without building)
pnpm dev --help
pnpm dev --version
pnpm dev inspect path/to/file.deepnote

# Run tests
pnpm test
```
