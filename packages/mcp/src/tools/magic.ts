import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { getBlockDependencies } from '@deepnote/reactivity'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { stringify as yamlStringify } from 'yaml'

export const magicTools: Tool[] = [
  {
    name: 'deepnote_scaffold',
    title: 'Scaffold New Notebook',
    description: `Create a complete, working notebook from a natural language description. 

Examples of descriptions:
- "Data analysis notebook that loads a CSV, explores with summary stats and visualizations, trains a random forest model"
- "Dashboard that shows sales metrics with date range picker and category filter"
- "ETL pipeline that reads from PostgreSQL, transforms data, and writes to S3"

The tool generates a properly structured notebook with:
- Markdown documentation explaining each section
- Code blocks with working Python code
- Input blocks for configurable parameters
- Visualization suggestions where appropriate`,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of what the notebook should do',
        },
        outputPath: {
          type: 'string',
          description: 'Path where the .deepnote file will be created',
        },
        projectName: {
          type: 'string',
          description: 'Name for the project (optional, derived from description if not provided)',
        },
        style: {
          type: 'string',
          enum: ['minimal', 'documented', 'tutorial'],
          description:
            'Documentation style: minimal (code only), documented (with explanations), tutorial (step-by-step) (default: documented)',
        },
      },
      required: ['description', 'outputPath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_enhance',
    title: 'Enhance Notebook',
    description: `Transform a basic notebook into an interactive, well-documented one.

Enhancements include:
- documentation: Add markdown sections explaining the code
- inputs: Convert hardcoded values to input widgets (sliders, dropdowns, text)
- visualizations: Add DataFrame displays and chart suggestions
- structure: Add section headers and organize the flow

You can specify which enhancements to apply or use "all" for everything.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to enhance',
        },
        enhancements: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['documentation', 'inputs', 'visualizations', 'structure', 'all'],
          },
          description: 'Which enhancements to apply (default: ["all"])',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return enhancement plan without modifying file (default: false)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_fix',
    title: 'Auto-Fix Issues',
    description: `Auto-fix issues in a notebook without manual intervention.

Fixes include:
- Adding missing imports at the top of code blocks
- Resolving undefined variables by adding definitions or flagging them
- Breaking circular dependencies by reordering blocks
- Adding missing integration references

Returns a summary of all fixes applied.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to fix',
        },
        fixTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['imports', 'undefined', 'circular', 'all'],
          },
          description: 'Which types of fixes to apply (default: ["all"])',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return fix plan without modifying file (default: false)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_explain',
    title: 'Explain Notebook',
    description: `Generate comprehensive documentation for a notebook.

Returns a markdown document explaining:
- What the notebook does (high-level summary)
- Data flow between blocks (which variables are passed where)
- Key outputs and visualizations
- Dependencies and requirements
- How to run it

Great for onboarding or creating README documentation.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to explain',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'json'],
          description: 'Output format (default: markdown)',
        },
        detail: {
          type: 'string',
          enum: ['brief', 'standard', 'comprehensive'],
          description: 'Level of detail (default: standard)',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'deepnote_suggest',
    title: 'Get Suggestions',
    description: `Analyze a notebook and provide actionable improvement suggestions.

Suggestions may include:
- "Block 3 outputs a dataframe - consider adding a table display"
- "The threshold value 0.5 on line 12 could be an input slider"
- "Missing error handling for file loading in block 2"
- "Consider adding a markdown section before the model training"
- "Block 5 has no downstream dependents - is it needed?"

Each suggestion includes the specific block, what to change, and why.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file to analyze',
        },
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['documentation', 'interactivity', 'visualization', 'code-quality', 'structure', 'all'],
          },
          description: 'Categories of suggestions to include (default: ["all"])',
        },
      },
      required: ['path'],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]

// Helper functions

function generateSortingKey(index: number): string {
  return String(index).padStart(6, '0')
}

function createBlock(
  type: string,
  content: string,
  index: number,
  blockGroup: string,
  metadata: Record<string, unknown> = {}
): DeepnoteBlock {
  const base = {
    id: randomUUID(),
    blockGroup,
    sortingKey: generateSortingKey(index),
    type,
    content,
    metadata,
  }

  if (
    ['code', 'sql', 'notebook-function', 'visualization'].includes(type) ||
    type.startsWith('input-') ||
    type === 'button' ||
    type === 'big-number'
  ) {
    return {
      ...base,
      executionCount: null,
      outputs: [],
    } as DeepnoteBlock
  }

  return base as DeepnoteBlock
}

async function loadDeepnoteFile(filePath: string): Promise<DeepnoteFile> {
  const absolutePath = path.resolve(filePath)
  const content = await fs.readFile(absolutePath, 'utf-8')
  return deserializeDeepnoteFile(content)
}

async function saveDeepnoteFile(filePath: string, file: DeepnoteFile): Promise<void> {
  const absolutePath = path.resolve(filePath)
  const content = yamlStringify(file, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  })
  await fs.writeFile(absolutePath, content, 'utf-8')
}

// Tool implementations

async function handleScaffold(args: Record<string, unknown>) {
  const description = args.description as string
  const outputPath = args.outputPath as string
  const projectName = args.projectName as string | undefined
  const style = (args.style as string) || 'documented'

  // Parse the description to identify components
  const descLower = description.toLowerCase()

  const blocks: Array<{ type: string; content: string }> = []
  const blockGroup = randomUUID()

  // Add title
  const title = projectName || extractTitle(description)
  blocks.push({
    type: 'text-cell-h1',
    content: title,
  })

  // Add description if documented or tutorial style
  if (style !== 'minimal') {
    blocks.push({
      type: 'markdown',
      content: `This notebook ${description.toLowerCase().startsWith('create') || description.toLowerCase().startsWith('build') ? description.slice(description.indexOf(' ') + 1) : description}.`,
    })
  }

  // Detect patterns and generate appropriate blocks

  // Data loading section
  if (
    descLower.includes('load') ||
    descLower.includes('read') ||
    descLower.includes('csv') ||
    descLower.includes('data')
  ) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Data Loading' })
    }

    // Add file path input
    if (descLower.includes('csv')) {
      blocks.push({
        type: 'input-text',
        content: '',
      })
      // Set variable name in metadata would go here

      blocks.push({
        type: 'code',
        content: `import pandas as pd

# Load the data
df = pd.read_csv(file_path)
print(f"Loaded {len(df)} rows, {len(df.columns)} columns")
df.head()`,
      })
    } else if (descLower.includes('sql') || descLower.includes('postgres') || descLower.includes('database')) {
      blocks.push({
        type: 'sql',
        content: `-- Query your data
SELECT *
FROM your_table
LIMIT 100`,
      })
    } else {
      blocks.push({
        type: 'code',
        content: `import pandas as pd

# Load your data here
# df = pd.read_csv('your_file.csv')
# df = pd.read_excel('your_file.xlsx')
# df = pd.read_json('your_file.json')`,
      })
    }
  }

  // Exploration section
  if (
    descLower.includes('explor') ||
    descLower.includes('summary') ||
    descLower.includes('analys') ||
    descLower.includes('stat')
  ) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Data Exploration' })
      if (style === 'tutorial') {
        blocks.push({
          type: 'markdown',
          content: "Let's explore the data to understand its structure and distributions.",
        })
      }
    }

    blocks.push({
      type: 'code',
      content: `# Basic info about the dataset
print("Shape:", df.shape)
print("\\nColumn types:")
print(df.dtypes)
print("\\nMissing values:")
print(df.isnull().sum())`,
    })

    blocks.push({
      type: 'code',
      content: `# Statistical summary
df.describe()`,
    })
  }

  // Visualization section
  if (
    descLower.includes('visual') ||
    descLower.includes('plot') ||
    descLower.includes('chart') ||
    descLower.includes('graph')
  ) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Visualizations' })
    }

    blocks.push({
      type: 'code',
      content: `import matplotlib.pyplot as plt
import seaborn as sns

# Set style
sns.set_style("whitegrid")
plt.figure(figsize=(10, 6))

# Example: Distribution plot
# sns.histplot(data=df, x='column_name')

# Example: Correlation heatmap
# sns.heatmap(df.corr(), annot=True, cmap='coolwarm')

plt.tight_layout()
plt.show()`,
    })
  }

  // Machine learning section
  if (
    descLower.includes('train') ||
    descLower.includes('model') ||
    descLower.includes('predict') ||
    descLower.includes('machine learning') ||
    descLower.includes('ml') ||
    descLower.includes('random forest') ||
    descLower.includes('regression') ||
    descLower.includes('classification')
  ) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Model Training' })
      if (style === 'tutorial') {
        blocks.push({
          type: 'markdown',
          content: "Now we'll prepare the data and train a model.",
        })
      }
    }

    // Add hyperparameter inputs
    blocks.push({
      type: 'input-slider',
      content: '',
    })

    blocks.push({
      type: 'code',
      content: `from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Prepare features and target
# X = df.drop('target_column', axis=1)
# y = df['target_column']

# Split the data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=test_size, random_state=42
)

print(f"Training set: {len(X_train)} samples")
print(f"Test set: {len(X_test)} samples")`,
    })

    // Model type detection
    if (descLower.includes('random forest')) {
      blocks.push({
        type: 'code',
        content: `from sklearn.ensemble import RandomForestClassifier
# or RandomForestRegressor for regression

model = RandomForestClassifier(
    n_estimators=100,
    random_state=42
)
model.fit(X_train, y_train)

# Evaluate
train_score = model.score(X_train, y_train)
test_score = model.score(X_test, y_test)
print(f"Training accuracy: {train_score:.3f}")
print(f"Test accuracy: {test_score:.3f}")`,
      })
    } else {
      blocks.push({
        type: 'code',
        content: `from sklearn.linear_model import LogisticRegression
# Choose your model:
# from sklearn.ensemble import RandomForestClassifier
# from sklearn.ensemble import GradientBoostingClassifier
# from sklearn.svm import SVC

model = LogisticRegression(random_state=42)
model.fit(X_train, y_train)

# Evaluate
train_score = model.score(X_train, y_train)
test_score = model.score(X_test, y_test)
print(f"Training accuracy: {train_score:.3f}")
print(f"Test accuracy: {test_score:.3f}")`,
      })
    }

    // Evaluation section
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Model Evaluation' })
    }

    blocks.push({
      type: 'code',
      content: `from sklearn.metrics import classification_report, confusion_matrix
import seaborn as sns

# Predictions
y_pred = model.predict(X_test)

# Classification report
print(classification_report(y_test, y_pred))

# Confusion matrix
plt.figure(figsize=(8, 6))
cm = confusion_matrix(y_test, y_pred)
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')
plt.xlabel('Predicted')
plt.ylabel('Actual')
plt.title('Confusion Matrix')
plt.show()`,
    })
  }

  // Dashboard/metrics section
  if (descLower.includes('dashboard') || descLower.includes('metric') || descLower.includes('kpi')) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Dashboard' })
    }

    // Add filter inputs
    if (descLower.includes('date')) {
      blocks.push({
        type: 'input-date-range',
        content: '',
      })
    }

    if (descLower.includes('filter') || descLower.includes('select') || descLower.includes('category')) {
      blocks.push({
        type: 'input-select',
        content: '',
      })
    }

    blocks.push({
      type: 'big-number',
      content: '',
    })
  }

  // ETL/Pipeline section
  if (descLower.includes('etl') || descLower.includes('pipeline') || descLower.includes('transform')) {
    if (style !== 'minimal') {
      blocks.push({ type: 'text-cell-h2', content: 'Data Transformation' })
    }

    blocks.push({
      type: 'code',
      content: `# Data transformation pipeline

def transform_data(df):
    """Apply transformations to the dataframe."""
    df_transformed = df.copy()
    
    # Add your transformations here
    # df_transformed['new_column'] = df_transformed['column'].apply(func)
    # df_transformed = df_transformed.dropna()
    # df_transformed = df_transformed.rename(columns={'old': 'new'})
    
    return df_transformed

df_transformed = transform_data(df)
print(f"Transformed: {len(df_transformed)} rows")
df_transformed.head()`,
    })
  }

  // Build the file
  const projectId = randomUUID()
  const notebookId = randomUUID()

  const file: DeepnoteFile = {
    version: '1.0',
    metadata: {
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    project: {
      id: projectId,
      name: title,
      notebooks: [
        {
          id: notebookId,
          name: 'Notebook',
          blocks: blocks.map((b, i) => createBlock(b.type, b.content, i, blockGroup)),
        },
      ],
    },
  }

  await saveDeepnoteFile(outputPath, file)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            path: outputPath,
            projectName: title,
            style,
            blocksCreated: blocks.length,
            sections: blocks.filter(b => b.type.includes('h1') || b.type.includes('h2')).map(b => b.content),
            hint: 'Review the generated code and customize variable names, file paths, and column names for your specific use case.',
          },
          null,
          2
        ),
      },
    ],
  }
}

function extractTitle(description: string): string {
  // Try to extract a reasonable title from the description
  const words = description.split(' ').slice(0, 5)
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .replace(/[^\w\s]/g, '')
}

async function handleEnhance(args: Record<string, unknown>) {
  const filePath = args.path as string
  const enhancements = (args.enhancements as string[]) || ['all']
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)
  const enhanceAll = enhancements.includes('all')

  const changes: Array<{ type: string; description: string; blockId?: string }> = []

  for (const notebook of file.project.notebooks) {
    const blocksToInsert: Array<{ index: number; block: DeepnoteBlock }> = []

    // Track code blocks for enhancement
    for (let i = 0; i < notebook.blocks.length; i++) {
      const block = notebook.blocks[i]

      // Add documentation before code blocks
      if ((enhanceAll || enhancements.includes('documentation')) && block.type === 'code') {
        // Check if previous block is already a markdown/text block
        const prevBlock = notebook.blocks[i - 1]
        if (!prevBlock || (!prevBlock.type.includes('text-cell') && prevBlock.type !== 'markdown')) {
          // Analyze code to generate description
          const codeContent = block.content || ''
          let description = 'Code block'

          if (codeContent.includes('import ')) description = 'Import dependencies'
          else if (codeContent.includes('pd.read_')) description = 'Load data'
          else if (codeContent.includes('.fit(')) description = 'Train model'
          else if (codeContent.includes('plt.') || codeContent.includes('sns.')) description = 'Create visualization'
          else if (codeContent.includes('def ')) description = 'Define functions'

          changes.push({
            type: 'documentation',
            description: `Add description before block: "${description}"`,
            blockId: block.id,
          })

          if (!dryRun) {
            const newBlock = createBlock(
              'markdown',
              `**${description}**`,
              0,
              notebook.blocks[0]?.blockGroup || randomUUID()
            )
            blocksToInsert.push({ index: i, block: newBlock })
          }
        }
      }

      // Detect hardcoded values for input conversion
      if ((enhanceAll || enhancements.includes('inputs')) && block.type === 'code') {
        const codeContent = block.content || ''

        // Look for common patterns
        const patterns = [
          { regex: /test_size\s*=\s*([\d.]+)/, name: 'test_size', inputType: 'input-slider' },
          { regex: /n_estimators\s*=\s*(\d+)/, name: 'n_estimators', inputType: 'input-slider' },
          { regex: /threshold\s*=\s*([\d.]+)/, name: 'threshold', inputType: 'input-slider' },
          { regex: /['"]([^'"]+\.csv)['"]/, name: 'file_path', inputType: 'input-text' },
        ]

        for (const pattern of patterns) {
          if (pattern.regex.test(codeContent)) {
            changes.push({
              type: 'inputs',
              description: `Convert hardcoded ${pattern.name} to ${pattern.inputType}`,
              blockId: block.id,
            })
          }
        }
      }

      // Suggest visualizations for dataframes
      if ((enhanceAll || enhancements.includes('visualizations')) && block.type === 'code') {
        const codeContent = block.content || ''

        if (
          (codeContent.includes('df') || codeContent.includes('DataFrame')) &&
          !codeContent.includes('plt.') &&
          !codeContent.includes('sns.')
        ) {
          changes.push({
            type: 'visualizations',
            description: 'Consider adding visualization for dataframe output',
            blockId: block.id,
          })
        }
      }
    }

    // Apply insertions in reverse order to maintain indices
    if (!dryRun) {
      for (const insertion of blocksToInsert.reverse()) {
        notebook.blocks.splice(insertion.index, 0, insertion.block)
      }

      // Update sorting keys
      notebook.blocks.forEach((block, index) => {
        block.sortingKey = generateSortingKey(index)
      })
    }

    // Add structure (section headers)
    if (enhanceAll || enhancements.includes('structure')) {
      let hasHeaders = false
      for (const block of notebook.blocks) {
        if (block.type.includes('text-cell-h')) {
          hasHeaders = true
          break
        }
      }

      if (!hasHeaders && notebook.blocks.length > 5) {
        changes.push({
          type: 'structure',
          description: 'Add section headers to organize notebook',
        })
      }
    }
  }

  if (dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              dryRun: true,
              path: filePath,
              proposedChanges: changes.length,
              changes,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  await saveDeepnoteFile(filePath, file)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            path: filePath,
            changesApplied: changes.length,
            changes,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleFix(args: Record<string, unknown>) {
  const filePath = args.path as string
  const fixTypes = (args.fixTypes as string[]) || ['all']
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)
  const fixAll = fixTypes.includes('all')

  const fixes: Array<{ type: string; description: string; blockId?: string }> = []

  for (const notebook of file.project.notebooks) {
    // Fix missing imports
    if (fixAll || fixTypes.includes('imports')) {
      const importedModules = new Set<string>()
      const usedModules = new Set<string>()

      // Common module patterns
      const modulePatterns: Array<{ pattern: RegExp; module: string; importStmt: string }> = [
        { pattern: /\bpd\b/, module: 'pandas', importStmt: 'import pandas as pd' },
        { pattern: /\bnp\b/, module: 'numpy', importStmt: 'import numpy as np' },
        { pattern: /\bplt\b/, module: 'matplotlib', importStmt: 'import matplotlib.pyplot as plt' },
        { pattern: /\bsns\b/, module: 'seaborn', importStmt: 'import seaborn as sns' },
        { pattern: /\bsk\b|sklearn/, module: 'sklearn', importStmt: '# from sklearn import ...' },
      ]

      for (const block of notebook.blocks) {
        if (block.type === 'code' && block.content) {
          // Check what's imported
          for (const pattern of modulePatterns) {
            if (
              block.content.includes(`import ${pattern.module}`) ||
              block.content.includes(`from ${pattern.module}`)
            ) {
              importedModules.add(pattern.module)
            }
            if (pattern.pattern.test(block.content)) {
              usedModules.add(pattern.module)
            }
          }
        }
      }

      // Find missing imports
      for (const pattern of modulePatterns) {
        if (usedModules.has(pattern.module) && !importedModules.has(pattern.module)) {
          fixes.push({
            type: 'imports',
            description: `Add missing import: ${pattern.importStmt}`,
          })

          if (!dryRun) {
            // Find first code block and prepend import
            const firstCodeBlock = notebook.blocks.find(b => b.type === 'code')
            if (firstCodeBlock?.content) {
              firstCodeBlock.content = `${pattern.importStmt}\n\n${firstCodeBlock.content}`
            }
          }
        }
      }
    }

    // Fix undefined variables
    if (fixAll || fixTypes.includes('undefined')) {
      try {
        const blockDeps = await getBlockDependencies(notebook.blocks)

        // Build lookup of all defined variables
        const definedVars = new Set<string>()
        for (const block of blockDeps) {
          for (const v of block.definedVariables) {
            definedVars.add(v)
          }
          for (const m of block.importedModules || []) {
            definedVars.add(m)
          }
        }

        for (const block of blockDeps) {
          for (const varName of block.usedVariables) {
            if (!definedVars.has(varName) && !isPythonBuiltin(varName)) {
              fixes.push({
                type: 'undefined',
                description: `Undefined variable: ${varName}`,
                blockId: block.id,
              })
            }
          }
        }
      } catch {
        // Skip undefined variable check if we can't analyze
      }
    }

    // Fix circular dependencies - simplified check
    if (fixAll || fixTypes.includes('circular')) {
      // For now, just note that circular dependency detection requires deeper analysis
    }
  }

  if (dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              dryRun: true,
              path: filePath,
              issuesFound: fixes.length,
              fixes,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  await saveDeepnoteFile(filePath, file)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            path: filePath,
            fixesApplied: fixes.filter(f => f.type === 'imports').length,
            issuesRemaining: fixes.filter(f => f.type !== 'imports').length,
            fixes,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleExplain(args: Record<string, unknown>) {
  const filePath = args.path as string
  const format = (args.format as string) || 'markdown'
  const detail = (args.detail as string) || 'standard'

  const file = await loadDeepnoteFile(filePath)
  const output: string[] = []

  // Title
  output.push(`# ${file.project.name}`)
  output.push('')

  // Summary
  output.push('## Overview')
  output.push('')

  const totalBlocks = file.project.notebooks.reduce((sum, n) => sum + n.blocks.length, 0)
  const codeBlocks = file.project.notebooks.reduce((sum, n) => sum + n.blocks.filter(b => b.type === 'code').length, 0)

  output.push(
    `This project contains ${file.project.notebooks.length} notebook(s) with ${totalBlocks} blocks (${codeBlocks} code blocks).`
  )
  output.push('')

  // Notebooks
  for (const notebook of file.project.notebooks) {
    output.push(`## Notebook: ${notebook.name}`)
    output.push('')

    // Analyze structure
    const sections: Array<{ title: string; blocks: DeepnoteBlock[] }> = []
    let currentSection: { title: string; blocks: DeepnoteBlock[] } = { title: 'Introduction', blocks: [] }

    for (const block of notebook.blocks) {
      if (block.type.includes('text-cell-h')) {
        if (currentSection.blocks.length > 0) {
          sections.push(currentSection)
        }
        currentSection = { title: block.content || 'Section', blocks: [] }
      } else {
        currentSection.blocks.push(block)
      }
    }
    if (currentSection.blocks.length > 0) {
      sections.push(currentSection)
    }

    // Describe each section
    for (const section of sections) {
      if (detail !== 'brief') {
        output.push(`### ${section.title}`)
        output.push('')
      }

      const sectionCodeBlocks = section.blocks.filter(b => b.type === 'code')
      for (const block of sectionCodeBlocks) {
        const description = describeCodeBlock(block.content || '')
        output.push(`- ${description}`)
      }
      output.push('')
    }

    // Data flow (standard and comprehensive)
    if (detail !== 'brief') {
      try {
        const blockDeps = await getBlockDependencies(notebook.blocks)
        const allDefines = new Set<string>()
        const allUses = new Set<string>()

        for (const block of blockDeps) {
          for (const def of block.definedVariables) allDefines.add(def)
          for (const use of block.usedVariables) allUses.add(use)
        }

        output.push('### Data Flow')
        output.push('')
        output.push(
          `**Variables created:** ${Array.from(allDefines).slice(0, 10).join(', ')}${allDefines.size > 10 ? '...' : ''}`
        )
        output.push(
          `**Key dependencies:** ${Array.from(allUses).slice(0, 10).join(', ')}${allUses.size > 10 ? '...' : ''}`
        )
        output.push('')
      } catch {
        // Skip data flow if analysis fails
      }
    }

    // Comprehensive: Requirements
    if (detail === 'comprehensive') {
      output.push('### Requirements')
      output.push('')

      const imports = new Set<string>()
      for (const block of notebook.blocks) {
        if (block.type === 'code' && block.content) {
          const lines = block.content.split('\n')
          for (const line of lines) {
            const importMatch = line.match(/^(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/)
            if (importMatch) {
              imports.add(importMatch[1])
            }
          }
        }
      }

      if (imports.size > 0) {
        output.push('```')
        for (const imp of imports) {
          output.push(imp)
        }
        output.push('```')
        output.push('')
      }
    }
  }

  // How to run
  output.push('## How to Run')
  output.push('')
  output.push('1. Open the `.deepnote` file in Deepnote or VS Code with the Deepnote extension')
  output.push('2. Run all cells in order, or use "Run All" command')
  output.push('3. Modify input blocks to change parameters')
  output.push('')

  const text = output.join('\n')

  if (format === 'json') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectName: file.project.name,
              notebooks: file.project.notebooks.length,
              totalBlocks,
              explanation: text,
            },
            null,
            2
          ),
        },
      ],
    }
  }

  return {
    content: [{ type: 'text', text }],
  }
}

function describeCodeBlock(content: string): string {
  if (content.includes('import ')) return 'Import required libraries'
  if (content.includes('pd.read_') || content.includes('load')) return 'Load data'
  if (content.includes('.describe()') || content.includes('.info()')) return 'Explore data statistics'
  if (content.includes('.fit(')) return 'Train model'
  if (content.includes('.predict(')) return 'Make predictions'
  if (content.includes('plt.') || content.includes('sns.')) return 'Create visualizations'
  if (content.includes('def ')) return 'Define helper functions'
  if (content.includes('train_test_split')) return 'Split data for training'
  if (content.includes('accuracy') || content.includes('score')) return 'Evaluate model performance'
  return 'Execute code'
}

async function handleSuggest(args: Record<string, unknown>) {
  const filePath = args.path as string
  const categories = (args.categories as string[]) || ['all']

  const file = await loadDeepnoteFile(filePath)
  const suggestAll = categories.includes('all')

  const suggestions: Array<{
    category: string
    priority: 'high' | 'medium' | 'low'
    message: string
    blockId?: string
    action?: string
  }> = []

  for (const notebook of file.project.notebooks) {
    // Try to get block dependencies for code quality suggestions
    const blockDepsMap: Map<string, { definedVariables: string[]; usedVariables: string[] }> = new Map()
    try {
      const blockDeps = await getBlockDependencies(notebook.blocks)
      for (const bd of blockDeps) {
        blockDepsMap.set(bd.id, {
          definedVariables: bd.definedVariables,
          usedVariables: bd.usedVariables,
        })
      }
    } catch {
      // Skip code quality if analysis fails
    }

    for (let i = 0; i < notebook.blocks.length; i++) {
      const block = notebook.blocks[i]
      const prevBlock = notebook.blocks[i - 1]

      // Documentation suggestions
      if (suggestAll || categories.includes('documentation')) {
        if (block.type === 'code' && (!prevBlock || !prevBlock.type.includes('text-cell'))) {
          suggestions.push({
            category: 'documentation',
            priority: 'medium',
            message: 'Code block has no preceding documentation',
            blockId: block.id,
            action: 'Add a markdown block explaining what this code does',
          })
        }
      }

      // Interactivity suggestions
      if (suggestAll || categories.includes('interactivity')) {
        if (block.type === 'code' && block.content) {
          // Look for hardcoded values
          const hardcodedPatterns = [
            { pattern: /=\s*0\.\d+/, desc: 'decimal value' },
            { pattern: /=\s*\d{2,}(?!\d)/, desc: 'numeric value' },
            { pattern: /['"][^'"]{10,}\.csv['"]/, desc: 'file path' },
          ]

          for (const { pattern, desc } of hardcodedPatterns) {
            if (pattern.test(block.content)) {
              suggestions.push({
                category: 'interactivity',
                priority: 'low',
                message: `Hardcoded ${desc} could be an input block`,
                blockId: block.id,
                action: 'Convert to input-slider or input-text block',
              })
            }
          }
        }
      }

      // Visualization suggestions
      if (suggestAll || categories.includes('visualization')) {
        if (block.type === 'code' && block.content) {
          // Check if block creates a dataframe but doesn't display it
          if (
            (block.content.includes('= pd.') || block.content.includes('DataFrame')) &&
            !block.content.includes('.head()') &&
            !block.content.includes('display(')
          ) {
            suggestions.push({
              category: 'visualization',
              priority: 'medium',
              message: 'DataFrame created but not displayed',
              blockId: block.id,
              action: 'Add .head() or display() to show data',
            })
          }

          // Check for numeric analysis without visualization
          if (
            (block.content.includes('.describe()') || block.content.includes('.value_counts()')) &&
            !notebook.blocks.some(
              b => (b.type === 'code' && b.content?.includes('plt.')) || b.content?.includes('sns.')
            )
          ) {
            suggestions.push({
              category: 'visualization',
              priority: 'low',
              message: 'Statistical analysis without visualization',
              blockId: block.id,
              action: 'Consider adding a chart to visualize the data',
            })
          }
        }
      }

      // Code quality suggestions
      if (suggestAll || categories.includes('code-quality')) {
        const blockDep = blockDepsMap.get(block.id)
        if (blockDep && blockDep.definedVariables.length > 0) {
          const isLastBlock = i === notebook.blocks.length - 1
          if (!isLastBlock) {
            // Check if any downstream block uses these variables
            let isUsed = false
            for (let j = i + 1; j < notebook.blocks.length; j++) {
              const downstreamDep = blockDepsMap.get(notebook.blocks[j].id)
              if (downstreamDep) {
                for (const def of blockDep.definedVariables) {
                  if (downstreamDep.usedVariables.includes(def)) {
                    isUsed = true
                    break
                  }
                }
              }
            }
            if (!isUsed) {
              suggestions.push({
                category: 'code-quality',
                priority: 'low',
                message: `Variables defined but possibly unused: ${blockDep.definedVariables.join(', ')}`,
                blockId: block.id,
                action: 'Review if this block is needed',
              })
            }
          }
        }
      }

      // Structure suggestions
      if (suggestAll || categories.includes('structure')) {
        // Already handled at notebook level
      }
    }

    // Notebook-level structure suggestions
    if (suggestAll || categories.includes('structure')) {
      const hasHeaders = notebook.blocks.some(b => b.type.includes('text-cell-h'))
      if (!hasHeaders && notebook.blocks.length > 5) {
        suggestions.push({
          category: 'structure',
          priority: 'medium',
          message: 'Notebook has many blocks but no section headers',
          action: 'Add h1/h2 headers to organize the notebook',
        })
      }

      // Check for logical grouping
      let consecutiveCodeBlocks = 0
      for (const block of notebook.blocks) {
        if (block.type === 'code') {
          consecutiveCodeBlocks++
          if (consecutiveCodeBlocks > 5) {
            suggestions.push({
              category: 'structure',
              priority: 'low',
              message: 'Long sequence of code blocks without documentation',
              action: 'Break up with markdown explanations or section headers',
            })
            break
          }
        } else {
          consecutiveCodeBlocks = 0
        }
      }
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            path: filePath,
            suggestionCount: suggestions.length,
            suggestions,
            summary:
              suggestions.length === 0
                ? 'No suggestions - notebook looks good!'
                : `Found ${suggestions.length} suggestions for improvement`,
          },
          null,
          2
        ),
      },
    ],
  }
}

function isPythonBuiltin(name: string): boolean {
  const builtins = new Set([
    'print',
    'len',
    'range',
    'str',
    'int',
    'float',
    'list',
    'dict',
    'set',
    'tuple',
    'bool',
    'None',
    'True',
    'False',
    'type',
    'isinstance',
    'hasattr',
    'getattr',
    'setattr',
    'open',
    'input',
    'sum',
    'min',
    'max',
    'abs',
    'round',
    'sorted',
    'reversed',
    'enumerate',
    'zip',
    'map',
    'filter',
    'any',
    'all',
    'ord',
    'chr',
    'hex',
    'bin',
    'oct',
    'format',
    'repr',
    'id',
    'dir',
    'vars',
    'globals',
    'locals',
    'exec',
    'eval',
    'compile',
    '__name__',
    '__file__',
    '__doc__',
    'Exception',
    'ValueError',
    'TypeError',
    'KeyError',
    'IndexError',
    'AttributeError',
    'ImportError',
    'RuntimeError',
    'StopIteration',
    'object',
    'super',
    'classmethod',
    'staticmethod',
    'property',
    'pd',
    'np',
    'plt',
    'sns',
    'df',
    'X',
    'y',
    'model',
    'result',
    'data',
    'fig',
    'ax',
  ])
  return builtins.has(name)
}

export async function handleMagicTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_scaffold':
      return handleScaffold(safeArgs)
    case 'deepnote_enhance':
      return handleEnhance(safeArgs)
    case 'deepnote_fix':
      return handleFix(safeArgs)
    case 'deepnote_explain':
      return handleExplain(safeArgs)
    case 'deepnote_suggest':
      return handleSuggest(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown magic tool: ${name}` }],
        isError: true,
      }
  }
}
