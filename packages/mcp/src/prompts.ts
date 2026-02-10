import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js'

export const prompts = [
  {
    name: 'debug_execution',
    description:
      'How to debug notebook execution using snapshots. Shows workflow for running, inspecting outputs, and fixing issues.',
    arguments: [
      {
        name: 'notebook_path',
        description: 'Path to the notebook to debug',
        required: true,
      },
      {
        name: 'execution_id',
        description: 'Optional execution id for the failed run',
        required: false,
      },
      {
        name: 'error_message',
        description: 'Optional error message from the failed run',
        required: false,
      },
    ],
  },
  {
    name: 'create_notebook',
    description:
      'Template for creating a new Deepnote notebook. Guides you through the scaffold tool with best practices.',
    arguments: [
      {
        name: 'purpose',
        description: 'What the notebook should do (e.g., "data analysis", "ML training", "dashboard")',
        required: true,
      },
      {
        name: 'data_source',
        description: 'Where data comes from (e.g., "CSV file", "SQL database", "API")',
        required: false,
      },
    ],
  },
  {
    name: 'convert_and_enhance',
    description: 'Workflow for converting a Jupyter/other notebook to Deepnote and enhancing it with interactivity.',
    arguments: [
      {
        name: 'source_path',
        description: 'Path to the notebook to convert',
        required: true,
      },
    ],
  },
  {
    name: 'fix_and_document',
    description: 'Workflow for fixing issues in a notebook and adding documentation.',
    arguments: [
      {
        name: 'notebook_path',
        description: 'Path to the .deepnote file',
        required: true,
      },
    ],
  },
  {
    name: 'block_types_reference',
    description: 'Quick reference for all Deepnote block types and their metadata options.',
    arguments: [],
  },
  {
    name: 'best_practices',
    description: 'Best practices for creating well-structured, interactive Deepnote notebooks.',
    arguments: [],
  },
] as const satisfies Prompt[]

export type PromptName = (typeof prompts)[number]['name']

const promptNameSet: Set<string> = new Set(prompts.map(prompt => prompt.name))

export function isPromptName(name: string): name is PromptName {
  return promptNameSet.has(name)
}

function assertNever(value: never): never {
  throw new Error(`Unknown prompt: ${String(value)}`)
}

export function getPrompt(name: PromptName, args: Record<string, string> | undefined): GetPromptResult {
  switch (name) {
    case 'debug_execution':
      return getDebugExecutionPrompt(args)
    case 'create_notebook':
      return getCreateNotebookPrompt(args)
    case 'convert_and_enhance':
      return getConvertAndEnhancePrompt(args)
    case 'fix_and_document':
      return getFixAndDocumentPrompt(args)
    case 'block_types_reference':
      return getBlockTypesReferencePrompt()
    case 'best_practices':
      return getBestPracticesPrompt()
    default:
      return assertNever(name)
  }
}

function getDebugExecutionPrompt(args: Record<string, string> | undefined): GetPromptResult {
  const notebookPath = args?.notebook_path || 'notebook.deepnote'
  const executionId = args?.execution_id
  const errorMessage = args?.error_message

  return {
    description: 'Debug notebook execution using snapshots',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Debug the notebook execution for: ${notebookPath}
${executionId ? `Execution ID: ${executionId}` : ''}
${errorMessage ? `Error message: ${errorMessage}` : ''}

## Understanding Outputs

**All execution outputs are saved to snapshot files.** After running a notebook:
1. The response includes \`snapshotPath\` - this is where all results live
2. Use \`deepnote_snapshot_load\` to inspect outputs

## Debugging Workflow

### Step 1: Run the notebook
\`\`\`
deepnote_run path="${notebookPath}"
\`\`\`

The response will include:
- \`snapshotPath\`: Path to saved outputs (e.g., "snapshots/notebook_uuid_latest.snapshot.deepnote")
- \`executedBlocks\`, \`failedBlocks\`: Execution summary
- \`results\`: Per-block success/failure info

### Step 2: Inspect the snapshot
\`\`\`
deepnote_snapshot_load path="<snapshotPath from step 1>"
\`\`\`

The snapshot contains:
- **Block outputs**: stdout, return values, charts
- **Errors**: Full tracebacks for failed blocks
- **Timing**: When execution started/finished
- **Execution counts**: Order blocks ran

### Step 3: Debug issues
If blocks failed:
1. Check error messages in the snapshot
2. Use \`deepnote_cat path="${notebookPath}" blockId="<failed-block-id>"\` to see the code
3. Fix the issue with \`deepnote_edit_block\`
4. Re-run and compare snapshots

### Step 4: Compare runs
Each run creates a new snapshot. Use \`deepnote_snapshot_list\` to see history and compare outputs between runs.

## Key Tools

| Tool | Purpose |
|------|---------|
| deepnote_run | Execute notebook, save outputs to snapshot |
| deepnote_snapshot_load | **Load outputs**, errors, timing from snapshot |
| deepnote_snapshot_list | Find available snapshots |
| deepnote_cat | View block source code |
| deepnote_edit_block | Fix code issues |`,
        },
      },
    ],
  }
}

function getCreateNotebookPrompt(args: Record<string, string> | undefined): GetPromptResult {
  const purpose = args?.purpose || 'data analysis'
  const dataSource = args?.data_source || 'CSV file'

  return {
    description: `Template for creating a ${purpose} notebook`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a Deepnote notebook for: ${purpose}

Data source: ${dataSource}

Use the deepnote_scaffold tool with these guidelines:
- Set style to "documented" for clear explanations
- The description should be specific about what the notebook does
- Include data loading, exploration, and output sections

Example tool call:
{
  "name": "deepnote_scaffold",
  "arguments": {
    "description": "${purpose} notebook that loads data from ${dataSource}, explores with summary statistics, and creates visualizations",
    "outputPath": "notebook.deepnote",
    "style": "documented"
  }
}

After creating, consider using deepnote_enhance to add:
- Interactive inputs for configurable parameters
- Better documentation between code sections`,
        },
      },
    ],
  }
}

function getConvertAndEnhancePrompt(args: Record<string, string> | undefined): GetPromptResult {
  const sourcePath = args?.source_path || 'notebook.ipynb'

  return {
    description: 'Workflow for converting and enhancing a notebook',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Convert and enhance the notebook at: ${sourcePath}

Follow this workflow:

1. **Convert to Deepnote format**:
   Use deepnote_convert_to with inputPath: "${sourcePath}"
   Format will be auto-detected from content.

2. **Inspect the result**:
   Use deepnote_inspect to see the structure and block counts.

3. **Enhance with interactivity**:
   Use deepnote_enhance with enhancements: ["all"]
   This adds:
   - Markdown documentation between code sections
   - Input widgets for hardcoded values (sliders, dropdowns)
   - DataFrame table displays
   - Section headers

4. **Check for issues**:
   Use deepnote_lint to find undefined variables or other problems.

5. **Get suggestions**:
   Use deepnote_suggest for additional improvement ideas.

The result will be a well-documented, interactive Deepnote notebook.`,
        },
      },
    ],
  }
}

function getFixAndDocumentPrompt(args: Record<string, string> | undefined): GetPromptResult {
  const notebookPath = args?.notebook_path || 'notebook.deepnote'

  return {
    description: 'Workflow for fixing and documenting a notebook',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Fix issues and add documentation to: ${notebookPath}

Follow this workflow:

1. **Check for issues**:
   Use deepnote_lint to identify:
   - Undefined variables
   - Missing imports
   - Circular dependencies

2. **Auto-fix issues**:
   Use deepnote_fix with dryRun: true first to preview
   Then deepnote_fix to apply fixes for:
   - Missing imports (adds them to first code block)
   - Flagged undefined variables

3. **Add documentation**:
   Use deepnote_enhance with enhancements: ["documentation", "structure"]
   This adds:
   - Markdown explanations before code blocks
   - Section headers to organize the notebook

4. **Generate README**:
   Use deepnote_explain with format: "markdown" and detail: "comprehensive"
   This creates documentation explaining:
   - What the notebook does
   - Data flow between blocks
   - Required dependencies
   - How to run it`,
        },
      },
    ],
  }
}

function getBlockTypesReferencePrompt(): GetPromptResult {
  return {
    description: 'Quick reference for Deepnote block types',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `# Deepnote Block Types Reference

## Executable Blocks (produce outputs)

| Type | Description | Key Metadata |
|------|-------------|--------------|
| code | Python code | - |
| sql | SQL queries | deepnote_variable_name |
| input-text | Single-line text input | deepnote_variable_name, deepnote_input_label, deepnote_input_default |
| input-textarea | Multi-line text input | deepnote_variable_name, deepnote_input_label |
| input-checkbox | Boolean toggle | deepnote_variable_name, deepnote_input_label, deepnote_input_default |
| input-select | Dropdown | deepnote_variable_name, deepnote_input_options, deepnote_input_default |
| input-slider | Numeric slider | deepnote_variable_name, deepnote_input_min, deepnote_input_max, deepnote_input_step |
| input-date | Date picker | deepnote_variable_name |
| input-date-range | Date range picker | deepnote_variable_name, deepnote_input_presets |
| button | Clickable button | deepnote_variable_name, deepnote_button_label |
| big-number | KPI display | deepnote_big_number_template |

## Text Blocks (display only)

| Type | Description |
|------|-------------|
| markdown | Rich markdown content |
| text-cell-h1 | Heading level 1 |
| text-cell-h2 | Heading level 2 |
| text-cell-h3 | Heading level 3 |
| text-cell-p | Paragraph |
| text-cell-bullet | Bullet list |
| text-cell-callout | Highlighted note (info/warning/error/success) |
| separator | Horizontal divider |
| image | Embedded image |

## Example: Creating an Input Slider

\`\`\`json
{
  "type": "input-slider",
  "metadata": {
    "deepnote_variable_name": "threshold",
    "deepnote_input_label": "Threshold",
    "deepnote_input_min": 0,
    "deepnote_input_max": 1,
    "deepnote_input_step": 0.1,
    "deepnote_input_default": 0.5
  }
}
\`\`\`

Use deepnote_add_block to add blocks with these types and metadata.`,
        },
      },
    ],
  }
}

function getBestPracticesPrompt(): GetPromptResult {
  return {
    description: 'Best practices for Deepnote notebooks',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `# Deepnote Notebook Best Practices

## Structure
- Start with a title (text-cell-h1) and introduction (markdown)
- Organize into sections with headers (text-cell-h2)
- Add markdown explanations before complex code blocks
- End with conclusions or next steps

## Interactivity
- Convert hardcoded values to input blocks:
  - File paths → input-text
  - Thresholds/parameters → input-slider
  - Categories → input-select
  - Toggles → input-checkbox
- Use meaningful variable names and labels

## Code Quality
- Keep code blocks focused on one task
- Use df.head() or display() to show dataframes
- Add error handling for file loading
- Import all dependencies at the start

## Documentation
- Explain the "why" not just the "what"
- Document expected input formats
- Note any external dependencies
- Add callouts for important warnings

## Tools Workflow

**For new notebooks:**
1. deepnote_scaffold → Creates complete notebook from description
2. deepnote_enhance → Adds inputs and better docs
3. deepnote_suggest → Get improvement ideas

**For existing notebooks:**
1. deepnote_lint → Find issues
2. deepnote_fix → Auto-fix problems
3. deepnote_enhance → Improve interactivity

**For analysis:**
1. deepnote_inspect → See structure
2. deepnote_dag → View dependencies
3. deepnote_explain → Generate docs`,
        },
      },
    ],
  }
}
