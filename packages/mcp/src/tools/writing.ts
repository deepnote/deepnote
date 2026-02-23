import { randomUUID } from 'node:crypto'
import { type DeepnoteBlock, type DeepnoteFile, deepnoteBlockSchema, serializeDeepnoteFile } from '@deepnote/blocks'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { generateSortingKey, loadDeepnoteFile, saveDeepnoteFile } from '../utils.js'

/**
 * Find a block by ID or ID prefix. Returns the block or undefined.
 */
function findBlock(blocks: DeepnoteBlock[], idOrPrefix: string): DeepnoteBlock | undefined {
  const matches = blocks.filter(b => b.id === idOrPrefix || b.id.startsWith(idOrPrefix))
  if (matches.length > 1) {
    throw new Error(`Ambiguous block ID prefix "${idOrPrefix}" matches multiple blocks`)
  }
  return matches[0]
}

/**
 * Find a block index by ID or ID prefix. Returns -1 if not found.
 */
function findBlockIndex(blocks: DeepnoteBlock[], idOrPrefix: string): number {
  const matches = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.id === idOrPrefix || block.id.startsWith(idOrPrefix))
  if (matches.length > 1) {
    throw new Error(`Ambiguous block ID prefix "${idOrPrefix}" matches multiple blocks`)
  }
  return matches.length === 1 ? matches[0].index : -1
}

/**
 * Resolve a block ID or prefix to the full block ID. Returns undefined if not found.
 */
function resolveBlockId(blocks: DeepnoteBlock[], idOrPrefix: string): string | undefined {
  const matches = blocks.filter(block => block.id === idOrPrefix || block.id.startsWith(idOrPrefix))
  if (matches.length > 1) {
    throw new Error(`Ambiguous block ID prefix "${idOrPrefix}" matches multiple blocks`)
  }
  return matches[0]?.id
}

function writingError(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  } as const
}

const nonEmptyStringSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'expected a non-empty string',
})

const metadataSchema = z.record(z.string(), z.unknown())

const createBlockSpecSchema = z.object({
  type: nonEmptyStringSchema,
  content: z.string().optional(),
  metadata: metadataSchema.optional(),
})

const createNotebookSpecSchema = z.object({
  name: nonEmptyStringSchema,
  blocks: z.array(createBlockSpecSchema),
})

const createArgsSchema = z.object({
  outputPath: nonEmptyStringSchema,
  projectName: nonEmptyStringSchema,
  notebooks: z.array(createNotebookSpecSchema),
  dryRun: z.boolean().optional(),
})

const addBlockPositionSchema = z.object({
  after: nonEmptyStringSchema.optional(),
  before: nonEmptyStringSchema.optional(),
  index: z.number().optional(),
})

const addBlockArgsSchema = z.object({
  path: nonEmptyStringSchema,
  notebook: nonEmptyStringSchema.optional(),
  block: createBlockSpecSchema,
  position: addBlockPositionSchema.optional(),
  dryRun: z.boolean().optional(),
})

const editBlockArgsSchema = z.object({
  path: nonEmptyStringSchema,
  blockId: nonEmptyStringSchema,
  content: z.string().optional(),
  metadata: metadataSchema.optional(),
  dryRun: z.boolean().optional(),
})

const removeBlockArgsSchema = z.object({
  path: nonEmptyStringSchema,
  blockId: nonEmptyStringSchema,
  dryRun: z.boolean().optional(),
})

const reorderBlocksArgsSchema = z.object({
  path: nonEmptyStringSchema,
  notebook: nonEmptyStringSchema.optional(),
  blockIds: z.array(z.string()),
  dryRun: z.boolean().optional(),
})

const addNotebookArgsSchema = z.object({
  path: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  blocks: z.array(createBlockSpecSchema).optional(),
  dryRun: z.boolean().optional(),
})

function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid arguments'
  const issuePath = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${issuePath}${issue.message}`
}

export const writingTools: Tool[] = [
  {
    name: 'deepnote_create',
    title: 'Create Notebook',
    description: 'Create a new .deepnote file from a specification. Provide project name, notebooks, and blocks.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: {
          type: 'string',
          description: 'Path where the .deepnote file will be created',
        },
        projectName: {
          type: 'string',
          description: 'Name of the project',
        },
        notebooks: {
          type: 'array',
          description: 'Array of notebooks to create',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Notebook name',
              },
              blocks: {
                type: 'array',
                description: 'Array of blocks in this notebook',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      description:
                        'Block type: code, sql, markdown, text-cell-h1, text-cell-h2, text-cell-p, input-text, input-slider, input-select, input-checkbox, etc.',
                    },
                    content: {
                      type: 'string',
                      description: 'Block content (code, markdown, etc.)',
                    },
                    metadata: {
                      type: 'object',
                      description: 'Optional metadata for the block',
                    },
                  },
                  required: ['type'],
                },
              },
            },
            required: ['name', 'blocks'],
          },
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return the file content without writing to disk (default: false)',
        },
      },
      required: ['outputPath', 'projectName', 'notebooks'],
    },
  },
  {
    name: 'deepnote_add_block',
    title: 'Add Block',
    description: 'Add a new block to an existing .deepnote file. Can position relative to other blocks.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        notebook: {
          type: 'string',
          description: 'Notebook name or ID to add the block to (uses first notebook if not specified)',
        },
        block: {
          type: 'object',
          description: 'Block to add',
          properties: {
            type: {
              type: 'string',
              description: 'Block type',
            },
            content: {
              type: 'string',
              description: 'Block content',
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata',
            },
          },
          required: ['type'],
        },
        position: {
          type: 'object',
          description: 'Where to insert the block',
          properties: {
            after: {
              type: 'string',
              description: 'Insert after this block ID',
            },
            before: {
              type: 'string',
              description: 'Insert before this block ID',
            },
            index: {
              type: 'number',
              description: 'Insert at this index (0-based)',
            },
          },
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'block'],
    },
  },
  {
    name: 'deepnote_edit_block',
    title: 'Edit Block',
    description: "Edit an existing block's content or metadata in a .deepnote file.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        blockId: {
          type: 'string',
          description: 'ID of the block to edit',
        },
        content: {
          type: 'string',
          description: 'New content for the block (optional)',
        },
        metadata: {
          type: 'object',
          description: 'Metadata to merge with existing metadata (optional)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'blockId'],
    },
  },
  {
    name: 'deepnote_remove_block',
    title: 'Remove Block',
    description: 'Remove a block from a .deepnote file by its ID.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        blockId: {
          type: 'string',
          description: 'ID of the block to remove',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'blockId'],
    },
  },
  {
    name: 'deepnote_reorder_blocks',
    title: 'Reorder Blocks',
    description: 'Reorder blocks within a notebook.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        notebook: {
          type: 'string',
          description: 'Notebook name or ID',
        },
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered list of block IDs (new order)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'blockIds'],
    },
  },
  {
    name: 'deepnote_add_notebook',
    title: 'Add Notebook',
    description: 'Add a new notebook to an existing .deepnote project.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the .deepnote file',
        },
        name: {
          type: 'string',
          description: 'Name for the new notebook',
        },
        blocks: {
          type: 'array',
          description: 'Initial blocks for the notebook (optional)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object' },
            },
            required: ['type'],
          },
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'name'],
    },
  },
]

function createBlock(
  spec: { type: string; content?: string; metadata?: Record<string, unknown> },
  index: number
): DeepnoteBlock {
  const base = {
    id: randomUUID(),
    blockGroup: randomUUID(),
    sortingKey: generateSortingKey(index),
    type: spec.type,
    content: spec.content !== undefined ? spec.content : '',
    metadata: spec.metadata !== undefined ? spec.metadata : {},
  }

  // Add execution fields for executable blocks
  const candidate =
    ['code', 'sql', 'notebook-function', 'visualization'].includes(spec.type) ||
    spec.type.startsWith('input-') ||
    spec.type === 'button' ||
    spec.type === 'big-number'
      ? {
          ...base,
          executionCount: null,
          outputs: [],
        }
      : base

  const parsed = deepnoteBlockSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(
      `Invalid block spec for type "${spec.type}": ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`
    )
  }

  return parsed.data
}

async function handleCreate(args: Record<string, unknown>) {
  const parsedArgs = createArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleCreate: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const { outputPath, projectName, notebooks, dryRun } = parsedArgs.data

  const projectId = randomUUID()

  const file: DeepnoteFile = {
    version: '1.0.0',
    metadata: {
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    project: {
      id: projectId,
      name: projectName,
      notebooks: notebooks.map(nb => {
        const notebookId = randomUUID()
        return {
          id: notebookId,
          name: nb.name,
          blocks: nb.blocks.map((block, index) => createBlock(block, index)),
        }
      }),
    },
  }

  if (dryRun) {
    const content = serializeDeepnoteFile(file)
    return {
      content: [
        {
          type: 'text',
          text: `Would create file at: ${outputPath}\n\nContent:\n${content}`,
        },
      ],
    }
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
            projectName,
            notebookCount: notebooks.length,
            totalBlocks: notebooks.reduce((sum, nb) => sum + nb.blocks.length, 0),
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleAddBlock(args: Record<string, unknown>) {
  const parsedArgs = addBlockArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleAddBlock: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const filePath = parsedArgs.data.path
  const notebookFilter = parsedArgs.data.notebook
  const blockSpec = parsedArgs.data.block
  const position = parsedArgs.data.position
  const dryRun = parsedArgs.data.dryRun === true

  const file = await loadDeepnoteFile(filePath)
  if (file.project.notebooks.length === 0) {
    return {
      content: [{ type: 'text', text: `No notebooks found for file "${file.project.name}" (${file.project.id})` }],
      isError: true,
    }
  }

  // Find the target notebook
  let notebook = file.project.notebooks[0]
  if (notebookFilter) {
    const found = file.project.notebooks.find(n => n.name === notebookFilter || n.id === notebookFilter)
    if (!found) {
      return {
        content: [{ type: 'text', text: `Notebook not found: ${notebookFilter}` }],
        isError: true,
      }
    }
    notebook = found
  }

  // Determine insertion index
  let insertIndex = notebook.blocks.length
  if (position?.after) {
    const afterIdx = findBlockIndex(notebook.blocks, position.after)
    if (afterIdx < 0) {
      throw new Error(`Invalid position.after: block not found (${position.after})`)
    }
    insertIndex = afterIdx + 1
  } else if (position?.before) {
    const beforeIdx = findBlockIndex(notebook.blocks, position.before)
    if (beforeIdx < 0) {
      throw new Error(`Invalid position.before: block not found (${position.before})`)
    }
    insertIndex = beforeIdx
  } else if (position?.index !== undefined) {
    if (!Number.isInteger(position.index) || position.index < 0 || position.index > notebook.blocks.length) {
      throw new Error(`Invalid position.index: expected integer in range 0..${notebook.blocks.length}`)
    }
    insertIndex = position.index
  }

  // Create the new block
  const newBlock = createBlock(blockSpec, insertIndex)

  // Insert the block
  notebook.blocks.splice(insertIndex, 0, newBlock)

  // Update sorting keys
  notebook.blocks.forEach((block, index) => {
    block.sortingKey = generateSortingKey(index)
  })

  if (dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              wouldAdd: {
                blockId: newBlock.id,
                type: newBlock.type,
                atIndex: insertIndex,
                inNotebook: notebook.name,
              },
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
            blockId: newBlock.id,
            type: newBlock.type,
            insertedAt: insertIndex,
            notebook: notebook.name,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleEditBlock(args: Record<string, unknown>) {
  const parsedArgs = editBlockArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleEditBlock: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const filePath = parsedArgs.data.path
  const blockId = parsedArgs.data.blockId
  const newContent = parsedArgs.data.content
  const newMetadata = parsedArgs.data.metadata
  const dryRun = parsedArgs.data.dryRun === true

  const file = await loadDeepnoteFile(filePath)

  // Find the block (supports ID prefix matching)
  let targetBlock: DeepnoteBlock | undefined
  let targetNotebook: string | undefined

  for (const notebook of file.project.notebooks) {
    const block = findBlock(notebook.blocks, blockId)
    if (block) {
      targetBlock = block
      targetNotebook = notebook.name
      break
    }
  }

  if (!targetBlock) {
    return {
      content: [{ type: 'text', text: `Block not found: ${blockId}` }],
      isError: true,
    }
  }

  const changes: string[] = []

  if (newContent !== undefined) {
    changes.push(`content: "${targetBlock.content?.slice(0, 50)}..." → "${newContent.slice(0, 50)}..."`)
    targetBlock.content = newContent
  }

  if (newMetadata) {
    changes.push(`metadata: merged new keys`)
    targetBlock.metadata = { ...targetBlock.metadata, ...newMetadata }
  }

  if (dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              wouldEdit: {
                blockId,
                notebook: targetNotebook,
                changes,
              },
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
            blockId,
            notebook: targetNotebook,
            changes,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleRemoveBlock(args: Record<string, unknown>) {
  const parsedArgs = removeBlockArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleRemoveBlock: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const filePath = parsedArgs.data.path
  const blockId = parsedArgs.data.blockId
  const dryRun = parsedArgs.data.dryRun === true

  const file = await loadDeepnoteFile(filePath)

  let removed = false
  let removedFrom: string | undefined

  for (const notebook of file.project.notebooks) {
    const index = findBlockIndex(notebook.blocks, blockId)
    if (index >= 0) {
      if (dryRun !== true) {
        notebook.blocks.splice(index, 1)
        // Update sorting keys
        notebook.blocks.forEach((block, i) => {
          block.sortingKey = generateSortingKey(i)
        })
      }
      removed = true
      removedFrom = notebook.name
      break
    }
  }

  if (!removed) {
    return {
      content: [{ type: 'text', text: `Block not found: ${blockId}` }],
      isError: true,
    }
  }

  if (dryRun === true) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              wouldRemove: {
                blockId,
                fromNotebook: removedFrom,
              },
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
            removedBlockId: blockId,
            fromNotebook: removedFrom,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleReorderBlocks(args: Record<string, unknown>) {
  const parsedArgs = reorderBlocksArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleReorderBlocks: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const filePath = parsedArgs.data.path
  const notebookFilter = parsedArgs.data.notebook
  const blockIds = parsedArgs.data.blockIds
  const dryRun = parsedArgs.data.dryRun === true

  const file = await loadDeepnoteFile(filePath)
  if (file.project.notebooks.length === 0) {
    return {
      content: [{ type: 'text', text: `No notebooks in project "${file.project.name}"` }],
      isError: true,
    }
  }

  // Find the target notebook
  let notebook = file.project.notebooks[0]
  if (notebookFilter) {
    const found = file.project.notebooks.find(n => n.name === notebookFilter || n.id === notebookFilter)
    if (!found) {
      return {
        content: [{ type: 'text', text: `Notebook not found: ${notebookFilter}` }],
        isError: true,
      }
    }
    notebook = found
  }

  // Resolve all block IDs (support prefix matching)
  const resolvedIds: string[] = []
  const resolvedIdSet = new Set<string>()
  for (const id of blockIds) {
    const fullId = resolveBlockId(notebook.blocks, id)
    if (!fullId) {
      return {
        content: [{ type: 'text', text: `Block not found: ${id}` }],
        isError: true,
      }
    }
    if (resolvedIdSet.has(fullId)) {
      return {
        content: [{ type: 'text', text: `Duplicate block ID in blockIds: ${id}` }],
        isError: true,
      }
    }
    resolvedIds.push(fullId)
    resolvedIdSet.add(fullId)
  }

  // Build a map of blocks by ID
  const blockMap = new Map(notebook.blocks.map(b => [b.id, b]))

  // Reorder blocks
  const reorderedBlocks = resolvedIds
    .map(id => blockMap.get(id))
    .filter((b): b is NonNullable<typeof b> => b !== undefined)

  // Add any blocks not in the list at the end (preserving their relative order)
  for (const block of notebook.blocks) {
    if (!resolvedIdSet.has(block.id)) {
      reorderedBlocks.push(block)
    }
  }

  // Update sorting keys
  reorderedBlocks.forEach((block, index) => {
    block.sortingKey = generateSortingKey(index)
  })

  notebook.blocks = reorderedBlocks

  if (dryRun) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              wouldReorder: {
                notebook: notebook.name,
                newOrder: resolvedIds.map(id => id.slice(0, 8)),
              },
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
            notebook: notebook.name,
            newBlockCount: notebook.blocks.length,
          },
          null,
          2
        ),
      },
    ],
  }
}

async function handleAddNotebook(args: Record<string, unknown>) {
  const parsedArgs = addNotebookArgsSchema.safeParse(args)
  if (!parsedArgs.success) {
    return writingError(`Invalid args in handleAddNotebook: ${formatFirstIssue(parsedArgs.error)}`)
  }
  const filePath = parsedArgs.data.path
  const name = parsedArgs.data.name
  const blocks = parsedArgs.data.blocks ?? []
  const dryRun = parsedArgs.data.dryRun === true

  const file = await loadDeepnoteFile(filePath)

  const notebookId = randomUUID()
  const newNotebook = {
    id: notebookId,
    name,
    blocks: blocks.map((block, index) => createBlock(block, index)),
  }

  if (dryRun === true) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              wouldAdd: {
                notebookId,
                name,
                blockCount: newNotebook.blocks.length,
              },
            },
            null,
            2
          ),
        },
      ],
    }
  }

  file.project.notebooks.push(newNotebook)
  await saveDeepnoteFile(filePath, file)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            notebookId,
            name,
            blockCount: newNotebook.blocks.length,
            totalNotebooks: file.project.notebooks.length,
          },
          null,
          2
        ),
      },
    ],
  }
}

export async function handleWritingTool(name: string, args: Record<string, unknown> | undefined) {
  const safeArgs = args || {}

  switch (name) {
    case 'deepnote_create':
      return handleCreate(safeArgs)
    case 'deepnote_add_block':
      return handleAddBlock(safeArgs)
    case 'deepnote_edit_block':
      return handleEditBlock(safeArgs)
    case 'deepnote_remove_block':
      return handleRemoveBlock(safeArgs)
    case 'deepnote_reorder_blocks':
      return handleReorderBlocks(safeArgs)
    case 'deepnote_add_notebook':
      return handleAddNotebook(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown writing tool: ${name}` }],
        isError: true,
      }
  }
}
