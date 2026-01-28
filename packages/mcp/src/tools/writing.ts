import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { stringify as yamlStringify } from 'yaml'

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
  {
    name: 'deepnote_bulk_edit',
    title: 'Bulk Edit Blocks',
    description:
      'Apply bulk changes to multiple blocks matching a filter. Useful for adding docstrings, updating metadata, etc.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
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
        filter: {
          type: 'object',
          description: 'Filter for which blocks to edit',
          properties: {
            type: {
              type: 'string',
              description: 'Block type to match',
            },
            notebook: {
              type: 'string',
              description: 'Notebook name or ID to match',
            },
            contentContains: {
              type: 'string',
              description: 'Only match blocks whose content contains this string',
            },
          },
        },
        transform: {
          type: 'object',
          description: 'Transformation to apply',
          properties: {
            prependContent: {
              type: 'string',
              description: 'Text to prepend to content',
            },
            appendContent: {
              type: 'string',
              description: 'Text to append to content',
            },
            replaceContent: {
              type: 'object',
              description: 'Find and replace in content',
              properties: {
                find: { type: 'string' },
                replace: { type: 'string' },
              },
            },
            setMetadata: {
              type: 'object',
              description: 'Metadata to set/merge',
            },
          },
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, return changes without writing (default: false)',
        },
      },
      required: ['path', 'filter', 'transform'],
    },
  },
]

function generateSortingKey(index: number): string {
  // Generate a sorting key that maintains order
  return String(index).padStart(6, '0')
}

function createBlock(
  spec: { type: string; content?: string; metadata?: Record<string, unknown> },
  index: number,
  blockGroup: string
): DeepnoteBlock {
  const base = {
    id: randomUUID(),
    blockGroup,
    sortingKey: generateSortingKey(index),
    type: spec.type,
    content: spec.content || '',
    metadata: spec.metadata || {},
  }

  // Add execution fields for executable blocks
  if (
    ['code', 'sql', 'notebook-function', 'visualization'].includes(spec.type) ||
    spec.type.startsWith('input-') ||
    spec.type === 'button' ||
    spec.type === 'big-number'
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

async function handleCreate(args: Record<string, unknown>) {
  const outputPath = args.outputPath as string
  const projectName = args.projectName as string
  const notebooks = args.notebooks as Array<{
    name: string
    blocks: Array<{ type: string; content?: string; metadata?: Record<string, unknown> }>
  }>
  const dryRun = args.dryRun as boolean | undefined

  const projectId = randomUUID()

  const file: DeepnoteFile = {
    version: '1.0',
    metadata: {
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    project: {
      id: projectId,
      name: projectName,
      notebooks: notebooks.map(nb => {
        const notebookId = randomUUID()
        const blockGroup = randomUUID()
        return {
          id: notebookId,
          name: nb.name,
          blocks: nb.blocks.map((block, index) => createBlock(block, index, blockGroup)),
        }
      }),
    },
  }

  if (dryRun) {
    const content = yamlStringify(file, {
      lineWidth: 0,
      defaultStringType: 'PLAIN',
      defaultKeyType: 'PLAIN',
    })
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
  const filePath = args.path as string
  const notebookFilter = args.notebook as string | undefined
  const blockSpec = args.block as {
    type: string
    content?: string
    metadata?: Record<string, unknown>
  }
  const position = args.position as { after?: string; before?: string; index?: number } | undefined
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

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
    const afterIdx = notebook.blocks.findIndex(b => b.id === position.after)
    if (afterIdx >= 0) insertIndex = afterIdx + 1
  } else if (position?.before) {
    const beforeIdx = notebook.blocks.findIndex(b => b.id === position.before)
    if (beforeIdx >= 0) insertIndex = beforeIdx
  } else if (position?.index !== undefined) {
    insertIndex = Math.min(position.index, notebook.blocks.length)
  }

  // Get blockGroup from existing blocks or create new one
  const blockGroup = notebook.blocks[0]?.blockGroup || randomUUID()

  // Create the new block
  const newBlock = createBlock(blockSpec, insertIndex, blockGroup)

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
  const filePath = args.path as string
  const blockId = args.blockId as string
  const newContent = args.content as string | undefined
  const newMetadata = args.metadata as Record<string, unknown> | undefined
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

  // Find the block
  let targetBlock: DeepnoteBlock | undefined
  let targetNotebook: string | undefined

  for (const notebook of file.project.notebooks) {
    const block = notebook.blocks.find(b => b.id === blockId)
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
  const filePath = args.path as string
  const blockId = args.blockId as string
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

  let removed = false
  let removedFrom: string | undefined

  for (const notebook of file.project.notebooks) {
    const index = notebook.blocks.findIndex(b => b.id === blockId)
    if (index >= 0) {
      if (!dryRun) {
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

  if (dryRun) {
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
  const filePath = args.path as string
  const notebookFilter = args.notebook as string | undefined
  const blockIds = args.blockIds as string[]
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

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

  // Build a map of blocks by ID
  const blockMap = new Map(notebook.blocks.map(b => [b.id, b]))

  // Verify all blockIds exist
  for (const id of blockIds) {
    if (!blockMap.has(id)) {
      return {
        content: [{ type: 'text', text: `Block not found: ${id}` }],
        isError: true,
      }
    }
  }

  // Reorder blocks (we verified all IDs exist above)
  const reorderedBlocks = blockIds
    .map(id => blockMap.get(id))
    .filter((b): b is NonNullable<typeof b> => b !== undefined)

  // Add any blocks not in the list at the end (preserving their relative order)
  for (const block of notebook.blocks) {
    if (!blockIds.includes(block.id)) {
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
                newOrder: blockIds.map(id => id.slice(0, 8)),
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
  const filePath = args.path as string
  const name = args.name as string
  const blocks = args.blocks as
    | Array<{ type: string; content?: string; metadata?: Record<string, unknown> }>
    | undefined
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

  const notebookId = randomUUID()
  const blockGroup = randomUUID()

  const newNotebook = {
    id: notebookId,
    name,
    blocks: (blocks || []).map((block, index) => createBlock(block, index, blockGroup)),
  }

  if (dryRun) {
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

async function handleBulkEdit(args: Record<string, unknown>) {
  const filePath = args.path as string
  const filter = args.filter as {
    type?: string
    notebook?: string
    contentContains?: string
  }
  const transform = args.transform as {
    prependContent?: string
    appendContent?: string
    replaceContent?: { find: string; replace: string }
    setMetadata?: Record<string, unknown>
  }
  const dryRun = args.dryRun as boolean | undefined

  const file = await loadDeepnoteFile(filePath)

  const edits: Array<{ blockId: string; notebook: string; changes: string[] }> = []

  for (const notebook of file.project.notebooks) {
    if (filter.notebook && notebook.name !== filter.notebook && notebook.id !== filter.notebook) {
      continue
    }

    for (const block of notebook.blocks) {
      // Apply filters
      if (filter.type && block.type !== filter.type) continue
      if (filter.contentContains && !block.content?.includes(filter.contentContains)) continue

      const changes: string[] = []

      // Apply transformations
      if (transform.prependContent && block.content !== undefined) {
        block.content = transform.prependContent + block.content
        changes.push('prepended content')
      }

      if (transform.appendContent && block.content !== undefined) {
        block.content = block.content + transform.appendContent
        changes.push('appended content')
      }

      if (transform.replaceContent && block.content) {
        const newContent = block.content.replace(
          new RegExp(transform.replaceContent.find, 'g'),
          transform.replaceContent.replace
        )
        if (newContent !== block.content) {
          block.content = newContent
          changes.push(`replaced "${transform.replaceContent.find}"`)
        }
      }

      if (transform.setMetadata) {
        block.metadata = { ...block.metadata, ...transform.setMetadata }
        changes.push('updated metadata')
      }

      if (changes.length > 0) {
        edits.push({
          blockId: block.id,
          notebook: notebook.name,
          changes,
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
              wouldEdit: edits.length,
              edits: edits.map(e => ({
                blockId: e.blockId.slice(0, 8),
                notebook: e.notebook,
                changes: e.changes,
              })),
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
            editedBlocks: edits.length,
            edits: edits.map(e => ({
              blockId: e.blockId.slice(0, 8),
              notebook: e.notebook,
              changes: e.changes,
            })),
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
    case 'deepnote_bulk_edit':
      return handleBulkEdit(safeArgs)
    default:
      return {
        content: [{ type: 'text', text: `Unknown writing tool: ${name}` }],
        isError: true,
      }
  }
}
