# @deepnote/mcp

MCP (Model Context Protocol) server for AI-assisted Deepnote notebook creation and manipulation.

This server follows MCP best practices (spec version 2025-11-25):

- **Server instructions**: Comprehensive usage guidance injected into AI's system prompt
- **MCP Prompts**: Pre-built workflow templates for common tasks
- **Bounded toolsets**: Focused tools with specific contracts
- **Self-documenting**: Comprehensive tool descriptions with usage guidance
- **Contracts first**: Strict input/output schemas, explicit side effects

## Installation

```bash
# Install globally
npm install -g @deepnote/mcp

# Or use with npx
npx @deepnote/mcp
```

## Usage with Cursor

Add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "deepnote": {
      "command": "npx",
      "args": ["@deepnote/mcp"]
    }
  }
}
```

## MCP Prompts

The server exposes pre-built workflow templates via the MCP Prompts capability:

| Prompt                  | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `create_notebook`       | Template for creating a new Deepnote notebook with best practices  |
| `convert_and_enhance`   | Workflow for converting Jupyter/other notebooks and enhancing them |
| `fix_and_document`      | Workflow for fixing issues and adding documentation                |
| `block_types_reference` | Quick reference for all block types and metadata                   |
| `best_practices`        | Best practices for well-structured notebooks                       |

Access prompts through your MCP client's prompt interface (e.g., slash commands in Cursor).

## MCP Resources

The server exposes notebook files as MCP Resources for easy discovery:

| Resource URI           | Description                                   |
| ---------------------- | --------------------------------------------- |
| `deepnote://examples`  | List of built-in example notebooks            |
| `deepnote://workspace` | All .deepnote files in the current workspace  |
| `deepnote://file/...`  | Individual notebook files with structure info |

Resources enable AI assistants to browse and understand notebooks without explicit file paths.

## Available Tools

### Magic Tools (high-level)

| Tool                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `deepnote_scaffold` | Create a complete notebook from a natural language description               |
| `deepnote_template` | Apply a pre-built template (dashboard, ml_pipeline, etl, report, api_client) |
| `deepnote_enhance`  | Transform a basic notebook into an interactive, well-documented one          |
| `deepnote_fix`      | Auto-fix issues (missing imports, undefined variables)                       |
| `deepnote_explain`  | Generate documentation explaining what a notebook does                       |
| `deepnote_suggest`  | Get improvement suggestions for a notebook                                   |
| `deepnote_refactor` | Extract reusable code into a module notebook                                 |
| `deepnote_profile`  | Add execution timing and memory profiling to code blocks                     |
| `deepnote_test`     | Generate test cells for functions and classes                                |
| `deepnote_workflow` | Execute a sequence of tools as a workflow pipeline                           |

### Reading Tools

| Tool               | Description                                      |
| ------------------ | ------------------------------------------------ |
| `deepnote_inspect` | Get notebook metadata and structure              |
| `deepnote_cat`     | Read block contents with filtering               |
| `deepnote_lint`    | Check for issues (undefined vars, circular deps) |
| `deepnote_stats`   | Get statistics (LOC, imports, block counts)      |
| `deepnote_analyze` | Comprehensive analysis with quality score        |
| `deepnote_dag`     | Show dependency graph between blocks             |
| `deepnote_diff`    | Compare two .deepnote files                      |

### Writing Tools

| Tool                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `deepnote_create`         | Create a new .deepnote file from a block specification |
| `deepnote_add_block`      | Add a block to an existing notebook                    |
| `deepnote_edit_block`     | Modify a block's content or metadata                   |
| `deepnote_remove_block`   | Remove a block by ID                                   |
| `deepnote_reorder_blocks` | Change block ordering                                  |
| `deepnote_add_notebook`   | Add a new notebook to a project                        |
| `deepnote_bulk_edit`      | Apply changes to multiple blocks                       |

### Conversion Tools

| Tool                     | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `deepnote_convert_to`    | Convert Jupyter/Quarto/Percent/Marimo to .deepnote |
| `deepnote_convert_from`  | Convert .deepnote to other formats                 |
| `deepnote_detect_format` | Detect format of a notebook file                   |

### Execution Tools

| Tool                 | Description                |
| -------------------- | -------------------------- |
| `deepnote_run`       | Execute a notebook locally |
| `deepnote_run_block` | Execute a specific block   |

## Examples

### Create a notebook from description

```
Use deepnote_scaffold with:
- description: "Data analysis notebook that loads CSV, explores with visualizations, trains a model"
- outputPath: "analysis.deepnote"
```

### Convert and enhance a Jupyter notebook

```
1. Use deepnote_convert_to with inputPath: "notebook.ipynb"
2. Use deepnote_enhance with enhancements: ["all"]
```

### Fix issues in a notebook

```
Use deepnote_fix with:
- path: "broken.deepnote"
- dryRun: true (preview first)
```

### Use a template

```
Use deepnote_template with:
- template: "dashboard" (or ml_pipeline, etl, report, api_client)
- outputPath: "my-dashboard.deepnote"
```

### Run a workflow pipeline

```
Use deepnote_workflow with steps:
1. template: Create ML pipeline
2. enhance: Add interactivity
3. suggest: Get improvement suggestions
```

### Generate tests for functions

```
Use deepnote_test with:
- path: "notebook.deepnote"
- testFramework: "pytest" (or unittest, assert)
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## License

Apache-2.0
