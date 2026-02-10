import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { decodeUtf8NoBom, deepnoteFileSchema, parseYaml } from '@deepnote/blocks'
import { getBlockDependencies } from '@deepnote/reactivity'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ZodIssue } from 'zod'
import { formatOutput, isPythonBuiltin, loadDeepnoteFile } from '../utils.js'

// --- Internal analysis helpers used by handleRead and individual handlers ---

function computeStructure(file: DeepnoteFile) {
  const blockCounts: Record<string, number> = {}
  let totalBlocks = 0

  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      blockCounts[block.type] = (blockCounts[block.type] || 0) + 1
      totalBlocks++
    }
  }

  return {
    projectName: file.project.name,
    projectId: file.project.id,
    notebooks: file.project.notebooks.map(n => ({
      name: n.name,
      id: n.id,
      blockCount: n.blocks.length,
      isModule: n.isModule || false,
    })),
    totalBlocks,
    blockCounts,
    hasIntegrations: (file.project.integrations?.length || 0) > 0,
  }
}

function computeStats(file: DeepnoteFile) {
  let totalLines = 0
  const imports = new Set<string>()
  const blockCounts: Record<string, number> = {}

  for (const notebook of file.project.notebooks) {
    for (const block of notebook.blocks) {
      blockCounts[block.type] = (blockCounts[block.type] || 0) + 1

      if (block.content) {
        const lines = block.content.split('\n')
        totalLines += lines.length

        if (block.type === 'code') {
          for (const line of lines) {
            const importMatch = line.match(/^(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/)
            if (importMatch) {
              imports.add(importMatch[1])
            }
          }
        }
      }
    }
  }

  return {
    totalLines,
    uniqueImports: Array.from(imports).sort(),
    importCount: imports.size,
    blockCounts,
    totalBlocks: Object.values(blockCounts).reduce((a, b) => a + b, 0),
  }
}

async function computeLintIssues(file: DeepnoteFile) {
  const issues: Array<{
    severity: 'error' | 'warning' | 'info'
    message: string
    notebook?: string
    blockId?: string
  }> = []

  for (const notebook of file.project.notebooks) {
    try {
      const blockDeps = await getBlockDependencies(notebook.blocks)

      const definedVars = new Set<string>()
      for (const block of blockDeps) {
        for (const v of block.definedVariables) definedVars.add(v)
        for (const m of block.importedModules || []) definedVars.add(m)
      }

      for (const block of blockDeps) {
        if (block.error) {
          issues.push({
            severity: 'warning',
            message: `Parse error: ${block.error.message}`,
            notebook: notebook.name,
            blockId: block.id,
          })
          continue
        }

        for (const varName of block.usedVariables) {
          if (!definedVars.has(varName) && !isPythonBuiltin(varName)) {
            issues.push({
              severity: 'error',
              message: `Undefined variable: ${varName}`,
              notebook: notebook.name,
              blockId: block.id,
            })
          }
        }
      }
    } catch {
      issues.push({
        severity: 'warning',
        message: 'Could not analyze dependencies',
        notebook: notebook.name,
      })
    }
  }

  return issues
}

async function computeDagInfo(file: DeepnoteFile, notebookFilter?: string) {
  const dagInfo: Array<{
    notebook: string
    blocks: Array<{
      id: string
      shortId: string
      defines: string[]
      uses: string[]
      dependsOn: string[]
    }>
  }> = []

  for (const notebook of file.project.notebooks) {
    if (notebookFilter && notebook.name !== notebookFilter && notebook.id !== notebookFilter) {
      continue
    }

    try {
      const blockDeps = await getBlockDependencies(notebook.blocks)
      const varToBlock = new Map<string, string>()

      for (const block of blockDeps) {
        for (const v of block.definedVariables) varToBlock.set(v, block.id)
        for (const m of block.importedModules || []) varToBlock.set(m, block.id)
      }

      const blocks = blockDeps.map(block => {
        const deps = new Set<string>()
        for (const usedVar of block.usedVariables) {
          const definingBlock = varToBlock.get(usedVar)
          if (definingBlock && definingBlock !== block.id) {
            deps.add(definingBlock)
          }
        }
        return {
          id: block.id,
          shortId: block.id.slice(0, 8),
          defines: block.definedVariables,
          uses: block.usedVariables,
          dependsOn: Array.from(deps),
        }
      })

      dagInfo.push({ notebook: notebook.name, blocks })
    } catch {
      dagInfo.push({ notebook: notebook.name, blocks: [] })
    }
  }

  return dagInfo
}

// --- End internal helpers ---

export const readingTools: Tool[] = [
  {
    name: 'deepnote_read',
    title: 'Read Notebook',
    description: 'Read and analyze notebook. Use include=[structure,stats,lint,dag,all] to combine operations.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['structure', 'stats', 'lint', 'dag', 'all'],
          },
          description:
            'What to include: structure (metadata), stats (lines/imports), lint (issues), dag (dependencies), all. Default: ["structure"]',
        },
        notebook: {
          type: 'string',
          description: 'Filter by notebook name or ID (for dag)',
        },
        compact: {
          type: 'boolean',
          description: 'Compact output mode - omit empty fields, use single-line format',
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
    name: 'deepnote_cat',
    title: 'View Block Contents',
    description: 'Display block contents. Filter by notebook, blockId, or blockType.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        notebook: {
          type: 'string',
          description: 'Filter by notebook name or ID (optional)',
        },
        blockId: {
          type: 'string',
          description: 'Show only a specific block by ID (optional)',
        },
        blockType: {
          type: 'string',
          description: 'Filter by block type: code, sql, markdown, input-text, input-slider, etc. (optional)',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include block metadata in output (default: false)',
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
    name: 'deepnote_validate',
    title: 'Validate Notebook',
    description: 'Validate YAML syntax and file structure against schema.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
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
    name: 'deepnote_diff',
    title: 'Compare Notebooks',
    description: 'Compare two files and show structural differences.',
    inputSchema: {
      type: 'object',
      properties: {
        path1: {
          type: 'string',
          description: 'Path to the first .deepnote file',
        },
        path2: {
          type: 'string',
          description: 'Path to the second .deepnote file',
        },
      },
      required: ['path1', 'path2'],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]

/**
 * Unified read handler that combines multiple reading operations
 */
async function handleRead(args: Record<string, unknown>) {
  const filePath = typeof args.path === 'string' ? args.path : undefined
  const includeRaw = args.include
  const notebookFilter = args.notebook as string | undefined
  const compact = args.compact as boolean | undefined

  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'path is required and must be a string' }],
      isError: true,
    }
  }

  // Default to structure only
  const includeValues =
    Array.isArray(includeRaw) && includeRaw.length > 0 && includeRaw.every(value => typeof value === 'string')
      ? includeRaw
      : ['structure']
  const include = new Set(includeValues)
  const includeAll = include.has('all')

  const file = await loadDeepnoteFile(filePath)
  const result: Record<string, unknown> = { path: filePath }

  if (includeAll || include.has('structure')) {
    result.structure = computeStructure(file)
  }

  if (includeAll || include.has('stats')) {
    const stats = computeStats(file)
    result.stats = {
      totalLines: stats.totalLines,
      uniqueImports: stats.uniqueImports,
      importCount: stats.importCount,
    }
  }

  if (includeAll || include.has('lint')) {
    const issues = await computeLintIssues(file)
    result.lint = {
      issueCount: issues.length,
      issues: compact && issues.length === 0 ? undefined : issues,
    }
  }

  if (includeAll || include.has('dag')) {
    result.dag = await computeDagInfo(file, notebookFilter)
  }

  return {
    content: [{ type: 'text', text: formatOutput(result, compact || false) }],
  }
}

async function handleCat(args: Record<string, unknown>) {
  const filePath = args.path as string
  const notebookFilter = args.notebook as string | undefined
  const blockIdFilter = args.blockId as string | undefined
  const blockTypeFilter = args.blockType as string | undefined
  const includeMetadata = args.includeMetadata as boolean | undefined

  const file = await loadDeepnoteFile(filePath)
  const output: string[] = []

  for (const notebook of file.project.notebooks) {
    if (notebookFilter && notebook.name !== notebookFilter && notebook.id !== notebookFilter) {
      continue
    }

    output.push(`## Notebook: ${notebook.name}`)
    output.push('')

    for (const block of notebook.blocks) {
      if (blockIdFilter && block.id !== blockIdFilter && !block.id.startsWith(blockIdFilter)) {
        continue
      }
      if (blockTypeFilter && block.type !== blockTypeFilter) {
        continue
      }

      output.push(`### Block: ${block.type} (${block.id.slice(0, 8)})`)

      if (block.content) {
        output.push('```')
        output.push(block.content)
        output.push('```')
      }

      if (includeMetadata && block.metadata) {
        output.push('**Metadata:**')
        output.push('```json')
        output.push(JSON.stringify(block.metadata, null, 2))
        output.push('```')
      }

      output.push('')
    }
  }

  return {
    content: [{ type: 'text', text: output.join('\n') }],
  }
}

function formatZodIssue(issue: ZodIssue): { path: string; message: string; code: string } {
  return {
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }
}

async function handleValidate(args: Record<string, unknown>) {
  const filePath = args.path as string
  const absolutePath = path.resolve(filePath)

  // Read file
  let rawBytes: Buffer
  try {
    rawBytes = await fs.readFile(absolutePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ valid: false, error: `Cannot read file: ${message}` }),
        },
      ],
    }
  }

  // Parse YAML
  const yamlContent = decodeUtf8NoBom(rawBytes)
  let parsed: unknown
  try {
    parsed = parseYaml(yamlContent)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: absolutePath,
            valid: false,
            issues: [{ path: '', message: `Invalid YAML: ${message}`, code: 'yaml_parse_error' }],
          }),
        },
      ],
    }
  }

  // Validate against schema
  const result = deepnoteFileSchema.safeParse(parsed)

  if (result.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: absolutePath,
            valid: true,
            issues: [],
          }),
        },
      ],
    }
  }

  // Format validation errors
  const issues = result.error.issues.map(formatZodIssue)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            path: absolutePath,
            valid: false,
            issueCount: issues.length,
            issues,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleDiff(args: Record<string, unknown>) {
  const path1 = args.path1 as string
  const path2 = args.path2 as string

  const file1 = await loadDeepnoteFile(path1)
  const file2 = await loadDeepnoteFile(path2)

  const differences: string[] = []

  // Compare project names
  if (file1.project.name !== file2.project.name) {
    differences.push(`Project name: "${file1.project.name}" vs "${file2.project.name}"`)
  }

  // Compare notebook counts
  if (file1.project.notebooks.length !== file2.project.notebooks.length) {
    differences.push(`Notebook count: ${file1.project.notebooks.length} vs ${file2.project.notebooks.length}`)
  }

  // Compare notebooks by name
  const notebooks1 = new Map(file1.project.notebooks.map(n => [n.name, n]))
  const notebooks2 = new Map(file2.project.notebooks.map(n => [n.name, n]))

  for (const [name, nb1] of notebooks1) {
    const nb2 = notebooks2.get(name)
    if (!nb2) {
      differences.push(`Notebook "${name}" only in first file`)
    } else if (nb1.blocks.length !== nb2.blocks.length) {
      differences.push(`Notebook "${name}": ${nb1.blocks.length} blocks vs ${nb2.blocks.length} blocks`)
    }
  }

  for (const [name] of notebooks2) {
    if (!notebooks1.has(name)) {
      differences.push(`Notebook "${name}" only in second file`)
    }
  }

  const result = {
    file1: path1,
    file2: path2,
    differenceCount: differences.length,
    differences,
    summary:
      differences.length === 0 ? 'Files are structurally identical' : `Found ${differences.length} difference(s)`,
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

export async function handleReadingTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_read':
      return handleRead(safeArgs)
    case 'deepnote_cat':
      return handleCat(safeArgs)
    case 'deepnote_validate':
      return handleValidate(safeArgs)
    case 'deepnote_diff':
      return handleDiff(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown reading tool: ${name}` }],
        isError: true,
      }
  }
}
