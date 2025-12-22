import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import * as uuid from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertPercentFilesToDeepnoteFile,
  convertPercentNotebookToBlocks,
  parsePercentFormat,
} from './percent-to-deepnote'

// Mock uuid to generate predictable IDs for testing
vi.mock('uuid', async () => {
  const actual = await vi.importActual<typeof import('uuid')>('uuid')
  let counter = 0
  const mockV4 = vi.fn(() => {
    counter++
    return `test-uuid-${counter.toString().padStart(3, '0')}`
  })
  ;(mockV4 as typeof mockV4 & { __resetCounter: () => void }).__resetCounter = () => {
    counter = 0
  }
  return {
    ...actual,
    v4: mockV4,
  }
})

function getMockedUuidV4() {
  return vi.mocked(uuid.v4) as ReturnType<typeof vi.mocked<typeof uuid.v4>> & { __resetCounter: () => void }
}

describe('parsePercentFormat', () => {
  it('parses a simple code cell', () => {
    const content = `# %%
print("hello")
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('code')
    expect(notebook.cells[0].content).toBe('print("hello")')
  })

  it('parses a markdown cell', () => {
    const content = `# %% [markdown]
# # Hello World
#
# This is a test.
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('markdown')
    expect(notebook.cells[0].content).toBe('# Hello World\n\nThis is a test.')
  })

  it('parses markdown cells with [md] shorthand', () => {
    const content = `# %% [md]
# Short markdown
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('markdown')
    expect(notebook.cells[0].content).toBe('Short markdown')
  })

  it('parses multiple cells', () => {
    const content = `# %% [markdown]
# # Title

# %%
x = 1

# %%
y = 2
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(3)
    expect(notebook.cells[0].cellType).toBe('markdown')
    expect(notebook.cells[0].content).toBe('# Title')
    expect(notebook.cells[1].cellType).toBe('code')
    expect(notebook.cells[1].content).toBe('x = 1')
    expect(notebook.cells[2].cellType).toBe('code')
    expect(notebook.cells[2].content).toBe('y = 2')
  })

  it('parses cells with titles', () => {
    const content = `# %% My Cell Title
print("hello")
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].title).toBe('My Cell Title')
  })

  it('parses cells with tags', () => {
    const content = `# %% tags=["exploration", "data"]
df.head()
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].tags).toEqual(['exploration', 'data'])
  })

  it('parses cells with both title and tags', () => {
    const content = `# %% Analysis code tags=["analysis"]
df.describe()
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].title).toBe('Analysis code')
    expect(notebook.cells[0].tags).toEqual(['analysis'])
  })

  it('parses raw cells', () => {
    const content = `# %% [raw]
This is raw content.
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('raw')
    expect(notebook.cells[0].content).toBe('This is raw content.')
  })

  it('handles empty content', () => {
    const notebook = parsePercentFormat('')

    expect(notebook.cells).toHaveLength(0)
  })

  it('handles content before first cell marker as code', () => {
    const content = `import pandas as pd
x = 1
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('code')
    expect(notebook.cells[0].content).toBe('import pandas as pd\nx = 1')
  })

  it('handles multiline code cells', () => {
    const content = `# %%
def greet(name):
    """Say hello."""
    return f"Hello, {name}!"

greet("World")
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].content).toBe(`def greet(name):
    """Say hello."""
    return f"Hello, {name}!"

greet("World")`)
  })

  it('handles markdown with code blocks', () => {
    const content = `# %% [markdown]
# ## Code Example
#
# \`\`\`python
# print("hello")
# \`\`\`
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].content).toBe(`## Code Example

\`\`\`python
print("hello")
\`\`\``)
  })
})

describe('convertPercentNotebookToBlocks', () => {
  beforeEach(() => {
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
  })

  it('converts a percent notebook to blocks', () => {
    const notebook = {
      cells: [
        { cellType: 'markdown' as const, content: '# Hello' },
        { cellType: 'code' as const, content: "print('hi')" },
      ],
    }

    const blocks = convertPercentNotebookToBlocks(notebook)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[0].content).toBe('# Hello')
    expect(blocks[1].type).toBe('code')
    expect(blocks[1].content).toBe("print('hi')")
  })

  it('uses custom idGenerator when provided', () => {
    let counter = 0
    const customIdGenerator = () => `custom-id-${++counter}`

    const notebook = {
      cells: [{ cellType: 'code' as const, content: 'x = 1' }],
    }

    const blocks = convertPercentNotebookToBlocks(notebook, {
      idGenerator: customIdGenerator,
    })

    expect(blocks[0].blockGroup).toBe('custom-id-1')
    expect(blocks[0].id).toBe('custom-id-2')
  })

  it('preserves title and tags in metadata', () => {
    const notebook = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'df.head()',
          title: 'Data exploration',
          tags: ['exploration'],
        },
      ],
    }

    const blocks = convertPercentNotebookToBlocks(notebook)

    expect(blocks[0].metadata).toEqual({
      title: 'Data exploration',
      tags: ['exploration'],
    })
  })

  it('generates correct sorting keys', () => {
    const notebook = {
      cells: Array.from({ length: 40 }, (_, i) => ({
        cellType: 'code' as const,
        content: `# Cell ${i}`,
      })),
    }

    const blocks = convertPercentNotebookToBlocks(notebook)

    expect(blocks[0].sortingKey).toBe('0')
    expect(blocks[9].sortingKey).toBe('9')
    expect(blocks[10].sortingKey).toBe('a')
    expect(blocks[35].sortingKey).toBe('z')
    expect(blocks[36].sortingKey).toBe('00')
  })
})

describe('convertPercentFilesToDeepnoteFile', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('converts a percent format file to Deepnote', async () => {
    const inputPath = path.join(testFixturesDir, 'simple.percent.py')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertPercentFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.version).toBe('1.0.0')
    expect(result.project.name).toBe('Simple Test')
    expect(result.project.notebooks).toHaveLength(1)

    const notebook = result.project.notebooks[0]
    expect(notebook.name).toBe('simple.percent')
    expect(notebook.blocks).toHaveLength(3)

    // First block is markdown
    expect(notebook.blocks[0].type).toBe('markdown')
    expect(notebook.blocks[0].content).toContain('Hello World')

    // Second block is code
    expect(notebook.blocks[1].type).toBe('code')
    expect(notebook.blocks[1].content).toBe('print("Hello, World!")')
  })

  it('converts the data analysis example', async () => {
    const inputPath = path.join(testFixturesDir, 'data-analysis.percent.py')
    const outputPath = path.join(tempDir, 'data-analysis.deepnote')

    await convertPercentFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Data Analysis',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(1)
    const notebook = result.project.notebooks[0]

    // Check we have the right number of cells
    expect(notebook.blocks.length).toBeGreaterThan(5)

    // Check tags are preserved
    const taggedBlocks = notebook.blocks.filter(
      b => b.metadata?.tags && (b.metadata.tags as string[]).includes('exploration')
    )
    expect(taggedBlocks.length).toBeGreaterThan(0)
  })

  it('converts multiple percent files into one Deepnote file', async () => {
    const inputPaths = [
      path.join(testFixturesDir, 'simple.percent.py'),
      path.join(testFixturesDir, 'data-analysis.percent.py'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertPercentFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(2)
    expect(result.project.notebooks[0].name).toBe('simple.percent')
    expect(result.project.notebooks[1].name).toBe('data-analysis.percent')
  })

  it('matches snapshot for simple.percent.py', async () => {
    const inputPath = path.join(testFixturesDir, 'simple.percent.py')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertPercentFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Simple Test
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: |-
                  # Hello World

                  This is a simple percent format notebook.
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: print("Hello, World!")
                id: test-uuid-005
                metadata: {}
                sortingKey: "1"
                type: code
              - blockGroup: test-uuid-006
                content: |-
                  x = 10
                  y = 20
                  result = x + y
                  print(f"Result: {result}")
                id: test-uuid-007
                metadata: {}
                sortingKey: "2"
                type: code
            executionMode: block
            id: test-uuid-008
            isModule: false
            name: simple.percent
        settings: {}
      version: 1.0.0
      "
    `)
  })
})
