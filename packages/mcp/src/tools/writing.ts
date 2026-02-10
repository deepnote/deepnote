import { randomUUID } from 'node:crypto'
import type { DeepnoteBlock, DeepnoteFile } from '@deepnote/blocks'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { stringify as yamlStringify } from 'yaml'
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

interface CreateBlockSpec {
  type: string
  content?: string
  metadata?: Record<string, unknown>
}

interface CreateNotebookSpec {
  name: string
  blocks: CreateBlockSpec[]
}

function writingError(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  } as const
}

function parseRequiredNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function validateCreateArgs(args: Record<string, unknown>): {
  outputPath: string
  projectName: string
  notebooks: CreateNotebookSpec[]
  dryRun: boolean | undefined
} {
  const outputPath = typeof args.outputPath === 'string' && args.outputPath.trim() ? args.outputPath : undefined
  const projectName = typeof args.projectName === 'string' && args.projectName.trim() ? args.projectName : undefined
  const dryRun = args.dryRun

  if (!outputPath) {
    throw new Error('Invalid outputPath: expected a non-empty string')
  }
  if (!projectName) {
    throw new Error('Invalid projectName: expected a non-empty string')
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    throw new Error('Invalid dryRun: expected a boolean if provided')
  }
  if (!Array.isArray(args.notebooks)) {
    throw new Error('Invalid notebooks: expected an array')
  }

  const notebooks: CreateNotebookSpec[] = args.notebooks.map((notebook, notebookIndex) => {
    if (typeof notebook !== 'object' || notebook === null) {
      throw new Error(`Invalid notebooks[${notebookIndex}]: expected an object`)
    }

    const notebookRecord = notebook as Record<string, unknown>
    const name = typeof notebookRecord.name === 'string' && notebookRecord.name.trim() ? notebookRecord.name : undefined
    if (!name) {
      throw new Error(`Invalid notebooks[${notebookIndex}].name: expected a non-empty string`)
    }

    if (!Array.isArray(notebookRecord.blocks)) {
      throw new Error(`Invalid notebooks[${notebookIndex}].blocks: expected an array`)
    }

    const blocks: CreateBlockSpec[] = notebookRecord.blocks.map((block, blockIndex) => {
      if (typeof block !== 'object' || block === null) {
        throw new Error(`Invalid notebooks[${notebookIndex}].blocks[${blockIndex}]: expected an object`)
      }
      const blockRecord = block as Record<string, unknown>
      const type = typeof blockRecord.type === 'string' && blockRecord.type.trim() ? blockRecord.type : undefined
      if (!type) {
        throw new Error(`Invalid notebooks[${notebookIndex}].blocks[${blockIndex}].type: expected a non-empty string`)
      }

      if (blockRecord.content !== undefined && typeof blockRecord.content !== 'string') {
        throw new Error(`Invalid notebooks[${notebookIndex}].blocks[${blockIndex}].content: expected a string`)
      }
      if (
        blockRecord.metadata !== undefined &&
        (typeof blockRecord.metadata !== 'object' ||
          blockRecord.metadata === null ||
          Array.isArray(blockRecord.metadata))
      ) {
        throw new Error(`Invalid notebooks[${notebookIndex}].blocks[${blockIndex}].metadata: expected an object`)
      }

      return {
        type,
        content: blockRecord.content as string | undefined,
        metadata: blockRecord.metadata as Record<string, unknown> | undefined,
      }
    })

    return { name, blocks }
  })

  return {
    outputPath,
    projectName,
    notebooks,
    dryRun: dryRun as boolean | undefined,
  }
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

async function handleCreate(args: Record<string, unknown>) {
  const { outputPath, projectName, notebooks, dryRun } = validateCreateArgs(args)

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
  const filePath = parseRequiredNonEmptyString(args.path)
  if (!filePath) {
    return writingError('Invalid filePath in handleAddBlock: args.path must be a non-empty string')
  }

  if (args.notebook !== undefined && parseOptionalNonEmptyString(args.notebook) === undefined) {
    return writingError(
      'Invalid notebookFilter in handleAddBlock: args.notebook must be a non-empty string when provided'
    )
  }
  const notebookFilter = parseOptionalNonEmptyString(args.notebook)

  if (typeof args.block !== 'object' || args.block === null || Array.isArray(args.block)) {
    return writingError('Invalid blockSpec in handleAddBlock: args.block must be an object')
  }
  const blockRaw = args.block as Record<string, unknown>
  const blockType = parseRequiredNonEmptyString(blockRaw.type)
  if (!blockType) {
    return writingError('Invalid blockSpec.type in handleAddBlock: args.block.type must be a non-empty string')
  }
  if (blockRaw.content !== undefined && typeof blockRaw.content !== 'string') {
    return writingError(
      'Invalid blockSpec.content in handleAddBlock: args.block.content must be a string when provided'
    )
  }
  if (
    blockRaw.metadata !== undefined &&
    (typeof blockRaw.metadata !== 'object' || blockRaw.metadata === null || Array.isArray(blockRaw.metadata))
  ) {
    return writingError(
      'Invalid blockSpec.metadata in handleAddBlock: args.block.metadata must be an object when provided'
    )
  }
  const blockSpec: { type: string; content?: string; metadata?: Record<string, unknown> } = {
    type: blockType,
    content: blockRaw.content as string | undefined,
    metadata: blockRaw.metadata as Record<string, unknown> | undefined,
  }

  if (
    args.position !== undefined &&
    (typeof args.position !== 'object' || args.position === null || Array.isArray(args.position))
  ) {
    return writingError('Invalid position in handleAddBlock: args.position must be an object when provided')
  }
  const positionRaw = (args.position || {}) as Record<string, unknown>
  if (positionRaw.after !== undefined && parseOptionalNonEmptyString(positionRaw.after) === undefined) {
    return writingError('Invalid position.after in handleAddBlock: expected a non-empty string')
  }
  if (positionRaw.before !== undefined && parseOptionalNonEmptyString(positionRaw.before) === undefined) {
    return writingError('Invalid position.before in handleAddBlock: expected a non-empty string')
  }
  if (positionRaw.index !== undefined && typeof positionRaw.index !== 'number') {
    return writingError('Invalid position.index in handleAddBlock: expected a number')
  }
  const position: { after?: string; before?: string; index?: number } | undefined =
    args.position === undefined
      ? undefined
      : {
          after: parseOptionalNonEmptyString(positionRaw.after),
          before: parseOptionalNonEmptyString(positionRaw.before),
          index: positionRaw.index as number | undefined,
        }

  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return writingError('Invalid dryRun in handleAddBlock: args.dryRun must be a boolean when provided')
  }
  const dryRun = args.dryRun === true

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
  const filePath = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path : undefined
  const blockId = typeof args.blockId === 'string' && args.blockId.trim().length > 0 ? args.blockId : undefined
  const newContentRaw = args.content
  const newMetadataRaw = args.metadata
  const dryRun = args.dryRun

  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Invalid filePath in handleEditBlock: args.path must be a non-empty string' }],
      isError: true,
    }
  }
  if (!blockId) {
    return {
      content: [{ type: 'text', text: 'Invalid blockId in handleEditBlock: args.blockId must be a non-empty string' }],
      isError: true,
    }
  }
  if (newContentRaw !== undefined && typeof newContentRaw !== 'string') {
    return {
      content: [
        { type: 'text', text: 'Invalid content in handleEditBlock: args.content must be a string when provided' },
      ],
      isError: true,
    }
  }
  if (
    newMetadataRaw !== undefined &&
    (typeof newMetadataRaw !== 'object' || newMetadataRaw === null || Array.isArray(newMetadataRaw))
  ) {
    return {
      content: [
        { type: 'text', text: 'Invalid metadata in handleEditBlock: args.metadata must be an object when provided' },
      ],
      isError: true,
    }
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return {
      content: [
        { type: 'text', text: 'Invalid dryRun in handleEditBlock: args.dryRun must be a boolean when provided' },
      ],
      isError: true,
    }
  }

  const newContent = newContentRaw as string | undefined
  const newMetadata = newMetadataRaw as Record<string, unknown> | undefined

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
  const filePath = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path : undefined
  const blockId = typeof args.blockId === 'string' && args.blockId.trim().length > 0 ? args.blockId : undefined
  const dryRun = args.dryRun

  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Invalid filePath in handleRemoveBlock: args.path must be a non-empty string' }],
      isError: true,
    }
  }
  if (!blockId) {
    return {
      content: [
        { type: 'text', text: 'Invalid blockId in handleRemoveBlock: args.blockId must be a non-empty string' },
      ],
      isError: true,
    }
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return {
      content: [
        { type: 'text', text: 'Invalid dryRun in handleRemoveBlock: args.dryRun must be a boolean when provided' },
      ],
      isError: true,
    }
  }

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
  const filePath = parseRequiredNonEmptyString(args.path)
  if (!filePath) {
    return writingError('Invalid filePath in handleReorderBlocks: args.path must be a non-empty string')
  }
  if (args.notebook !== undefined && parseOptionalNonEmptyString(args.notebook) === undefined) {
    return writingError(
      'Invalid notebookFilter in handleReorderBlocks: args.notebook must be a non-empty string when provided'
    )
  }
  const notebookFilter = parseOptionalNonEmptyString(args.notebook)

  const blockIds = args.blockIds
  if (!Array.isArray(blockIds) || !blockIds.every(id => typeof id === 'string')) {
    return writingError('Invalid blockIds in handleReorderBlocks: args.blockIds must be an array of strings')
  }

  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return writingError('Invalid dryRun in handleReorderBlocks: args.dryRun must be a boolean when provided')
  }
  const dryRun = args.dryRun === true

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
  const filePath = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path : undefined
  const name = typeof args.name === 'string' && args.name.trim().length > 0 ? args.name : undefined
  const blocksRaw = args.blocks
  const dryRun = args.dryRun

  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Invalid filePath in handleAddNotebook: args.path must be a non-empty string' }],
      isError: true,
    }
  }
  if (!name) {
    return {
      content: [{ type: 'text', text: 'Invalid name in handleAddNotebook: args.name must be a non-empty string' }],
      isError: true,
    }
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return {
      content: [
        { type: 'text', text: 'Invalid dryRun in handleAddNotebook: args.dryRun must be a boolean when provided' },
      ],
      isError: true,
    }
  }
  if (blocksRaw !== undefined && !Array.isArray(blocksRaw)) {
    return {
      content: [
        { type: 'text', text: 'Invalid blocks in handleAddNotebook: args.blocks must be an array when provided' },
      ],
      isError: true,
    }
  }

  const blocks: Array<{ type: string; content?: string; metadata?: Record<string, unknown> }> = []
  for (const [index, rawBlock] of (blocksRaw || []).entries()) {
    if (typeof rawBlock !== 'object' || rawBlock === null) {
      return {
        content: [{ type: 'text', text: `Invalid blocks[${index}] in handleAddNotebook: expected an object` }],
        isError: true,
      }
    }
    const block = rawBlock as Record<string, unknown>
    const type = typeof block.type === 'string' && block.type.trim().length > 0 ? block.type : undefined
    if (!type) {
      return {
        content: [
          { type: 'text', text: `Invalid blocks[${index}].type in handleAddNotebook: expected a non-empty string` },
        ],
        isError: true,
      }
    }
    if (block.content !== undefined && typeof block.content !== 'string') {
      return {
        content: [{ type: 'text', text: `Invalid blocks[${index}].content in handleAddNotebook: expected a string` }],
        isError: true,
      }
    }
    if (
      block.metadata !== undefined &&
      (typeof block.metadata !== 'object' || block.metadata === null || Array.isArray(block.metadata))
    ) {
      return {
        content: [{ type: 'text', text: `Invalid blocks[${index}].metadata in handleAddNotebook: expected an object` }],
        isError: true,
      }
    }
    blocks.push({
      type,
      content: block.content as string | undefined,
      metadata: block.metadata as Record<string, unknown> | undefined,
    })
  }

  const file = await loadDeepnoteFile(filePath)

  const notebookId = randomUUID()
  const blockGroup = randomUUID()

  const newNotebook = {
    id: notebookId,
    name,
    blocks: blocks.map((block, index) => createBlock(block, index, blockGroup)),
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
