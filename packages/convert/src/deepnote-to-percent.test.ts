import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  convertBlocksToPercentNotebook,
  convertDeepnoteFileToPercentFiles,
  convertDeepnoteToPercentNotebooks,
  serializePercentFormat,
} from './deepnote-to-percent'
import { convertPercentNotebookToBlocks, parsePercentFormat } from './percent-to-deepnote'

describe('serializePercentFormat', () => {
  it('serializes a simple code cell', () => {
    const notebook = {
      cells: [{ cellType: 'code' as const, content: 'print("hello")' }],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %%
print("hello")
`)
  })

  it('serializes a markdown cell with comment prefixes', () => {
    const notebook = {
      cells: [{ cellType: 'markdown' as const, content: '# Hello World\n\nThis is a test.' }],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% [markdown]
# # Hello World
#
# This is a test.
`)
  })

  it('serializes multiple cells', () => {
    const notebook = {
      cells: [
        { cellType: 'markdown' as const, content: '# Title' },
        { cellType: 'code' as const, content: 'x = 1' },
        { cellType: 'code' as const, content: 'y = 2' },
      ],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% [markdown]
# # Title

# %%
x = 1

# %%
y = 2
`)
  })

  it('serializes cells with titles', () => {
    const notebook = {
      cells: [{ cellType: 'code' as const, content: 'print("hello")', title: 'My Cell' }],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% My Cell
print("hello")
`)
  })

  it('serializes cells with tags', () => {
    const notebook = {
      cells: [{ cellType: 'code' as const, content: 'df.head()', tags: ['exploration', 'data'] }],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% tags=["exploration", "data"]
df.head()
`)
  })

  it('serializes cells with tags containing special characters', () => {
    const notebook = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'print("test")',
          tags: ['tag with "quotes"', 'tag with \\ backslash', 'tag with\nnewline'],
        },
      ],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% tags=["tag with \\"quotes\\"", "tag with \\\\ backslash", "tag with\\nnewline"]
print("test")
`)
  })

  it('serializes cells with both title and tags', () => {
    const notebook = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'df.describe()',
          title: 'Analysis',
          tags: ['analysis'],
        },
      ],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% Analysis tags=["analysis"]
df.describe()
`)
  })

  it('serializes raw cells', () => {
    const notebook = {
      cells: [{ cellType: 'raw' as const, content: 'Raw content here' }],
    }

    const result = serializePercentFormat(notebook)

    expect(result).toBe(`# %% [raw]
Raw content here
`)
  })
})

describe('convertBlocksToPercentNotebook', () => {
  it('converts markdown blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: '# Hello World',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('markdown')
    expect(notebook.cells[0].content).toBe('# Hello World')
  })

  it('restores raw cells from metadata', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: 'Raw content\nNo processing',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          percent_cell_type: 'raw',
        },
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('raw')
    expect(notebook.cells[0].content).toBe('Raw content\nNo processing')
  })

  it('converts code blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'print("hello")',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('code')
    expect(notebook.cells[0].content).toBe('print("hello")')
  })

  it('preserves title and tags from metadata', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'df.head()',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          title: 'Data preview',
          tags: ['exploration'],
        },
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells[0].title).toBe('Data preview')
    expect(notebook.cells[0].tags).toEqual(['exploration'])
  })

  it('converts SQL blocks to code cells with generated Python', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'sql',
        content: 'SELECT * FROM users',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          deepnote_variable_name: 'df_users',
        },
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('code')
    // Should contain the generated Python code for SQL with the variable name
    expect(notebook.cells[0].content).toContain('df_users')
    // Should contain the SQL query
    expect(notebook.cells[0].content).toContain('SELECT * FROM users')
    // Should contain the Deepnote toolkit SQL execution call
    expect(notebook.cells[0].content).toContain('_dntk.execute_sql')
  })

  it('converts text blocks to markdown cells', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'text-cell-p',
        content: 'Some text content',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToPercentNotebook(blocks)

    expect(notebook.cells[0].cellType).toBe('markdown')
  })
})

describe('convertDeepnoteToPercentNotebooks', () => {
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

  it('converts a Deepnote file to percent notebook objects', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToPercentNotebooks(deepnoteFile)

    expect(notebooks.length).toBeGreaterThan(0)
    expect(notebooks[0]).toHaveProperty('filename')
    expect(notebooks[0]).toHaveProperty('notebook')
    expect(notebooks[0].filename).toMatch(/\.py$/)
  })

  it('sanitizes filenames by removing invalid characters', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToPercentNotebooks(deepnoteFile)

    notebooks.forEach(({ filename }) => {
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).toMatch(/\.py$/)
    })
  })
})

describe('convertDeepnoteFileToPercentFiles', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('converts a Deepnote file to percent format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToPercentFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(file => file.endsWith('.py'))).toBe(true)
  })

  it('creates valid percent format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToPercentFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const pyFile = files.find(file => file.endsWith('.py'))
    expect(pyFile).toBeDefined()

    if (pyFile) {
      const content = await fs.readFile(path.join(outputDir, pyFile), 'utf-8')
      // Verify it's valid percent format by parsing it
      const notebook = parsePercentFormat(content)
      expect(notebook.cells.length).toBeGreaterThan(0)
    }
  })
})

describe('convertDeepnoteFileToPercentFiles error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rejects with a clear error when the .deepnote file does not exist', async () => {
    const nonExistentPath = path.join(__dirname, '../test-fixtures/does-not-exist.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await expect(convertDeepnoteFileToPercentFiles(nonExistentPath, { outputDir })).rejects.toThrow(
      /ENOENT|no such file/
    )
  })

  it('rejects with an error when the file contains invalid YAML', async () => {
    const invalidYamlPath = path.join(tempDir, 'invalid.deepnote')
    await fs.writeFile(invalidYamlPath, 'invalid: [yaml: {missing closing bracket', 'utf-8')

    const outputDir = path.join(tempDir, 'output')

    await expect(convertDeepnoteFileToPercentFiles(invalidYamlPath, { outputDir })).rejects.toThrow()
  })
})

describe('Percent format roundtrip', () => {
  it('preserves raw cells during roundtrip', () => {
    const original = `# %% [raw]
Raw content
No processing

# %% [markdown]
# Markdown

# %%
print("code")
`
    const notebook = parsePercentFormat(original)
    const serialized = serializePercentFormat(notebook)
    const reparsed = parsePercentFormat(serialized)

    expect(reparsed.cells.length).toBe(3)
    expect(reparsed.cells[0].cellType).toBe('raw')
    expect(reparsed.cells[0].content).toBe('Raw content\nNo processing')
    expect(reparsed.cells[1].cellType).toBe('markdown')
    expect(reparsed.cells[2].cellType).toBe('code')
  })

  it('preserves content during parse → serialize roundtrip', () => {
    const original = `# %% [markdown]
# # Hello World
#
# This is a test.

# %%
print("hello")

# %% tags=["test"]
x = 1
`
    const notebook = parsePercentFormat(original)
    const serialized = serializePercentFormat(notebook)
    const reparsed = parsePercentFormat(serialized)

    expect(reparsed.cells.length).toBe(notebook.cells.length)
    for (let i = 0; i < notebook.cells.length; i++) {
      expect(reparsed.cells[i].cellType).toBe(notebook.cells[i].cellType)
      expect(reparsed.cells[i].content).toBe(notebook.cells[i].content)
      expect(reparsed.cells[i].title).toBe(notebook.cells[i].title)
      expect(reparsed.cells[i].tags).toEqual(notebook.cells[i].tags)
    }
  })

  it('preserves raw cells through Deepnote roundtrip', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: 'Raw content',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          percent_cell_type: 'raw',
        },
      },
      {
        id: 'block-2',
        type: 'code',
        content: 'print("test")',
        blockGroup: 'group-2',
        sortingKey: '1',
        metadata: {},
      },
    ]

    // Convert to percent
    const percentNotebook = convertBlocksToPercentNotebook(blocks)
    expect(percentNotebook.cells[0].cellType).toBe('raw')

    // Convert back to Deepnote
    const roundtrippedBlocks = convertPercentNotebookToBlocks(percentNotebook)
    expect(roundtrippedBlocks[0].type).toBe('markdown')
    expect(roundtrippedBlocks[0].metadata).toHaveProperty('percent_cell_type', 'raw')
  })

  it('preserves Deepnote → Percent → Deepnote content', async () => {
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const testFixturesDir = path.join(__dirname, '../../../test-fixtures')
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(yamlContent)

    // Convert to percent
    const percentNotebooks = convertDeepnoteToPercentNotebooks(original)

    // Serialize and reparse
    for (const { notebook } of percentNotebooks) {
      const serialized = serializePercentFormat(notebook)
      const reparsed = parsePercentFormat(serialized)

      // Cell count should match
      expect(reparsed.cells.length).toBe(notebook.cells.length)
    }
  })
})
