/**
 * Server instructions that get added to the AI's system prompt.
 * This is the MCP-standard way to provide "skills" to the AI.
 */
export const serverInstructions = `# Deepnote MCP Server

This server provides tools for creating, editing, running, and converting Deepnote notebooks (.deepnote files).

## IMPORTANT: Understanding Execution Outputs

**All execution outputs are saved to snapshot files (.snapshot.deepnote).**

When you run a notebook with \`deepnote_run\`:
1. The notebook executes locally
2. All outputs (stdout, stderr, charts, errors, timing) are saved to a snapshot file
3. The response includes \`snapshotPath\` - **this is where results live**
4. Use \`deepnote_snapshot_load\` to inspect outputs and debug

**Debugging workflow:**
1. \`deepnote_run path=notebook.deepnote\` → runs and saves snapshot
2. Check \`snapshotPath\` in the response
3. \`deepnote_snapshot_load path=<snapshotPath>\` → load and inspect outputs
4. Review block outputs, errors, execution timing
5. Fix issues in source, re-run, compare results

**Key point:** If you need to see what a notebook produced (output values, errors, charts), you MUST load the snapshot. The run response only contains summary info.

**Important:** Always use \`deepnote_snapshot_load\` to read snapshots - do NOT read .snapshot.deepnote files directly with file read tools. The snapshot loader parses and structures the outputs for you.

## Structure: Projects, Notebooks, and Blocks

A \`.deepnote\` file is a **project** containing one or more **notebooks**, each containing **blocks**.

**Hierarchy (smallest to largest):**
- **Block** - Single unit: code cell, markdown, input widget, SQL query
- **Notebook** - Collection of blocks that execute together (like a Jupyter notebook)
- **Project** - The \`.deepnote\` file containing all notebooks, settings, and integrations

**Execution scopes (from focused to broad):**
1. \`deepnote_run_block\` - Run ONE block (+ its dependencies)
2. \`deepnote_run notebook=X\` - Run ONE notebook
3. \`deepnote_run\` - Run ALL notebooks in project

**Development tip:** Start small, verify, then expand:
- Build block by block within a notebook
- Once a notebook works, add the next notebook
- Run at project level only when all pieces are verified

## Quick Start

**Running and debugging notebooks:**
- Use \`deepnote_run\` to execute (supports .deepnote, .ipynb, .py, .qmd)
- Check \`snapshotPath\` in response for outputs
- Use \`deepnote_snapshot_load\` to inspect results and debug

**Creating notebooks:**
- Use \`deepnote_scaffold\` for simple, well-understood patterns
- For complex/custom logic: build incrementally with \`deepnote_create\` → \`deepnote_add_block\` → \`deepnote_run_block\` → verify → repeat

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

**Building notebooks incrementally (RECOMMENDED for complex/custom logic):**
1. \`deepnote_create\` to create empty project with one notebook
2. \`deepnote_add_block\` to add first code block
3. \`deepnote_run_block\` to execute just that block
4. \`deepnote_snapshot_load\` to verify output is correct
5. Repeat: add next block → run block → verify
6. Once notebook is complete, run full notebook to confirm
7. For multi-notebook projects: add next notebook, repeat process

**Why incremental?** When blocks depend on each other (e.g., block 2 uses variables from block 1), building incrementally ensures each step works before adding the next. Debugging one block at a time is much easier than debugging a 10-block notebook with multiple failures.

**Anti-pattern:** Adding multiple blocks without executing after each one. If you add 5 blocks then run, you'll have 5 potential failure points to debug at once.

**Scope your execution:**
- Developing a block? → \`deepnote_run_block\`
- Testing a notebook? → \`deepnote_run notebook=name\`
- Final verification? → \`deepnote_run\` (full project)

**Import and improve existing notebook:**
1. \`deepnote_convert_from\` to import
2. \`deepnote_read include=[lint]\` to check for issues (or use \`deepnote_workflow preset=import\`)
3. \`deepnote_fix\` to auto-repair
4. \`deepnote_enhance\` to add interactivity

**Analyze notebook structure:**
1. \`deepnote_read include=[structure,stats,lint,dag]\` for comprehensive analysis in one call
2. Or use individual tools: \`deepnote_inspect\`, \`deepnote_dag\` (requires full mode)
3. \`deepnote_explain\` to generate documentation

**Working with snapshots (execution outputs):**
1. \`deepnote_snapshot_load\` - **Load and inspect outputs** (stdout, errors, charts, timing)
2. \`deepnote_snapshot_list\` - Find available snapshots for a project
3. \`deepnote_snapshot_split\` - Separate outputs from source for clean version control
4. \`deepnote_snapshot_merge\` - Restore outputs back into a clean source

**Key:** After \`deepnote_run\`, always check \`snapshotPath\` and use \`deepnote_snapshot_load\` to see actual outputs. Snapshots contain everything: stdout, stderr, return values, charts, errors, and execution timing.

**Do NOT** read snapshot files directly with file read tools - always use \`deepnote_snapshot_load\` which parses and structures the data.

**Tip:** Snapshots are valid .deepnote files. You can run them directly with \`deepnote_run\` for debugging - this lets you re-execute and compare results.

## Execution Levels

A .deepnote project can contain multiple notebooks. Execution can be scoped to:

1. **Project level** (default): \`deepnote_run\` runs ALL notebooks in order
2. **Notebook level**: \`deepnote_run\` with \`notebook\` parameter runs a single notebook
3. **Block level**: \`deepnote_run_block\` runs a specific block (and its dependencies)

Use \`dryRun: true\` to preview execution plan without running.

## Performance Modes

The server operates in two modes for optimal performance:

**Compact mode (default):** Optimized for speed and token efficiency
- Responses are minimal single-line JSON
- Redundant tools hidden (use \`deepnote_read\` instead of inspect/stats/lint/dag)
- Use \`deepnote_workflow\` with presets for multi-step operations
- If an error occurs, the server automatically retries with verbose output

**Full mode:** For debugging or when you need more detail
- Call \`deepnote_mode mode=full\` to switch
- All granular tools available (inspect, stats, lint, dag)
- Verbose output with hints and suggestions

**When you see "Escalated to verbose mode":** The operation encountered an issue and was retried with full output for debugging. After resolving, continue using compact mode.

**Recommended:** Use \`deepnote_read\` with \`include=[structure,stats,lint,dag]\` to combine multiple analysis operations in one call.

## Best Practices

- Start notebooks with a title (text-cell-h1) and introduction
- Organize with section headers (text-cell-h2)
- Convert hardcoded values to input blocks for interactivity
- Add markdown explanations before complex code
- Use deepnote_lint to catch issues before running
- For dependent blocks, build incrementally: add → run → verify → add next
- Scope execution appropriately: block → notebook → project (smallest scope that tests what you need)
- Prefer \`deepnote_run_block\` during development, \`deepnote_run\` for final verification
`
