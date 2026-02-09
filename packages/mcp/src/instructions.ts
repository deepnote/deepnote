/**
 * Server instructions that get added to the AI's system prompt.
 * This is the MCP-standard way to provide "skills" to the AI.
 */
export const serverInstructions = `# Deepnote MCP Server

Tools for creating, editing, running, and converting Deepnote notebooks (.deepnote files).

## IMPORTANT: Always work in .deepnote format

When something goes wrong, do NOT fall back to converting to .ipynb and working in Jupyter format. The .deepnote format has much better debugging tools (\`deepnote_lint\`, \`deepnote_read\`, \`deepnote_dag\`, \`deepnote_fix\`, \`deepnote_snapshot_load\`) that are not available for .ipynb files. Stay in .deepnote and use these tools to diagnose and fix issues. Only use \`deepnote_convert_to\` when the user explicitly asks for export.

## Structure

A \`.deepnote\` file is a **project** containing **notebooks**, each containing **blocks**.
- **Block** - Code cell, markdown, input widget, SQL query
- **Notebook** - Collection of blocks (like a Jupyter notebook)
- **Project** - The \`.deepnote\` file with all notebooks, settings, and integrations

## Execution and Snapshots

Execution outputs are saved to snapshot files (.snapshot.deepnote). Use \`deepnote_snapshot_load\` to inspect them -- do NOT read snapshot files directly.

**Execution scopes (smallest to largest):**
1. \`deepnote_run_block\` - One block + dependencies (use during development)
2. \`deepnote_run notebook=X\` - One notebook
3. \`deepnote_run\` - All notebooks (use for final verification)

Use \`dryRun: true\` to preview execution plan without running.

## Quick Start

**Create:** \`deepnote_scaffold\` for common patterns, or build incrementally with \`deepnote_create\` + \`deepnote_add_block\` + \`deepnote_run_block\`
**Convert:** \`deepnote_convert_from\` to import (.ipynb, .qmd, .py), \`deepnote_convert_to\` to export
**Improve:** \`deepnote_enhance\` (interactivity), \`deepnote_fix\` (auto-repair), \`deepnote_suggest\` (recommendations)
**Analyze:** \`deepnote_read\` (unified), \`deepnote_dag\` (dependencies), \`deepnote_explain\` (documentation)

## Block Types

**Executable:** \`code\`, \`sql\`, \`input-text\`, \`input-slider\`, \`input-select\`, \`input-checkbox\`, \`input-date\`, \`input-date-range\`, \`button\`, \`big-number\`
**Text:** \`markdown\`, \`text-cell-h1/h2/h3\`, \`text-cell-p\`, \`text-cell-bullet\`, \`text-cell-callout\`, \`separator\`, \`image\`

## Input Block Metadata

- \`deepnote_variable_name\` - Variable name for the input's value
- \`deepnote_input_label\` - Display label
- \`deepnote_input_default\` - Default value
- \`deepnote_input_min/max/step\` - For sliders
- \`deepnote_input_options\` - For select dropdowns

## Incremental Development (recommended for complex logic)

1. \`deepnote_create\` → \`deepnote_add_block\` → \`deepnote_run_block\` → verify with \`deepnote_snapshot_load\`
2. Repeat: add block → run → verify
3. Once complete, \`deepnote_run\` full notebook/project

Build block by block. Adding multiple blocks without testing after each one makes debugging harder.

## Best Practices

- Start notebooks with a title (text-cell-h1) and introduction
- Organize with section headers (text-cell-h2)
- Convert hardcoded values to input blocks for interactivity
- Use \`deepnote_lint\` to catch issues before running
- Scope execution to the smallest level needed
`
