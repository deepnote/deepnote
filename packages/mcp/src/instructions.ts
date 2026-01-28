/**
 * Server instructions that get added to the AI's system prompt.
 * This is the MCP-standard way to provide "skills" to the AI.
 */
export const serverInstructions = `# Deepnote MCP Server

This server provides tools for creating, editing, running, and converting Deepnote notebooks (.deepnote files).

## Quick Start

**Creating notebooks:**
- Use \`deepnote_scaffold\` to generate a complete notebook from a description
- Use \`deepnote_create\` + \`deepnote_add_block\` for manual construction

**Converting notebooks:**
- Use \`deepnote_convert_from\` to import from Jupyter (.ipynb), Quarto (.qmd), or Python (.py)
- Use \`deepnote_convert_to\` to export to other formats

**Improving notebooks:**
- Use \`deepnote_enhance\` to add interactivity (inputs, better docs)
- Use \`deepnote_fix\` to auto-fix issues (missing imports, undefined vars)
- Use \`deepnote_suggest\` to get improvement recommendations

## Block Types

Deepnote notebooks contain blocks. Key types:

**Executable blocks** (produce outputs):
- \`code\` - Python code
- \`sql\` - SQL queries (requires \`deepnote_variable_name\` metadata)
- \`input-text\`, \`input-slider\`, \`input-select\`, \`input-checkbox\` - Interactive inputs
- \`input-date\`, \`input-date-range\` - Date pickers
- \`button\` - Clickable buttons
- \`big-number\` - KPI displays

**Text blocks** (display only):
- \`markdown\` - Rich markdown
- \`text-cell-h1/h2/h3\` - Headers
- \`text-cell-p\` - Paragraphs
- \`text-cell-bullet\` - Bullet lists
- \`text-cell-callout\` - Highlighted notes (info/warning/error)
- \`separator\` - Horizontal divider
- \`image\` - Embedded images

## Key Metadata Fields

When creating input blocks, use these metadata fields:
- \`deepnote_variable_name\` - Variable name for the input's value
- \`deepnote_input_label\` - Display label
- \`deepnote_input_default\` - Default value
- \`deepnote_input_min/max/step\` - For sliders
- \`deepnote_input_options\` - For select dropdowns

## Recommended Workflows

**New data analysis notebook:**
1. \`deepnote_scaffold\` with detailed description
2. \`deepnote_enhance\` to add inputs for parameters
3. \`deepnote_suggest\` for improvement ideas

**Import and improve existing notebook:**
1. \`deepnote_convert_from\` to import
2. \`deepnote_lint\` to check for issues
3. \`deepnote_fix\` to auto-repair
4. \`deepnote_enhance\` to add interactivity

**Analyze notebook structure:**
1. \`deepnote_inspect\` to see structure
2. \`deepnote_dag\` to view dependencies
3. \`deepnote_explain\` to generate documentation

## Best Practices

- Start notebooks with a title (text-cell-h1) and introduction
- Organize with section headers (text-cell-h2)
- Convert hardcoded values to input blocks for interactivity
- Add markdown explanations before complex code
- Use deepnote_lint to catch issues before running
`
