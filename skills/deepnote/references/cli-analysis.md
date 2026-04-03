# CLI: Analysis Commands

Install: `npm install -g @deepnote/cli`

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

**Exit codes:** 0 = valid, 1 = runtime error, 2 = invalid file or invalid usage.

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

| Option                  | Description                      |
| ----------------------- | -------------------------------- |
| `-o, --output <format>` | Output format: `json`, `llm`     |
| `--notebook <name>`     | Analyze only a specific notebook |

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
