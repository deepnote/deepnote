import * as crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertPercentFilesToDeepnoteFile,
  convertPercentNotebookToBlocks,
  parsePercentFormat,
} from './percent-to-deepnote'

// Mock crypto.randomUUID to generate predictable IDs for testing
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  let counter = 0
  const mockRandomUUID = vi.fn(() => {
    counter++
    return `test-uuid-${counter.toString().padStart(3, '0')}`
  })
  ;(mockRandomUUID as typeof mockRandomUUID & { __resetCounter: () => void }).__resetCounter = () => {
    counter = 0
  }
  return {
    ...actual,
    randomUUID: mockRandomUUID,
  }
})

function getMockedRandomUUID() {
  return vi.mocked(crypto.randomUUID) as ReturnType<typeof vi.mocked<typeof crypto.randomUUID>> & {
    __resetCounter: () => void
  }
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

  it('parses raw cells', () => {
    const content = `# %% [raw]
Raw content here
No processing
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cellType).toBe('raw')
    expect(notebook.cells[0].content).toBe('Raw content here\nNo processing')
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

  it('known limitation: tags with brackets are not fully parsed', () => {
    // This documents a known limitation: the simple regex stops at the first ']'
    // so tag values containing brackets won't be parsed correctly.
    // A full parser would be needed to handle nested brackets with quoted strings.
    const content = `# %% tags=["tag[0]", "normal"]
code()
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    // The tag with brackets is truncated - this is the known limitation
    expect(notebook.cells[0].tags).toEqual(['tag[0'])
    // Note: "normal" is lost because the regex stopped at the first ']'
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

  it('preserves relative indentation in multiline code cells', () => {
    // This test ensures that indentation is correctly preserved:
    // each line should maintain its original indentation relative to other lines
    const content = `# %%
import os
import sqlalchemy

_password = os.environ.get("POSTGRES_PASSWORD", "postgres")
DATABASE_URL = f"postgresql://postgres:{_password}@localhost:5432/squeal"
engine = sqlalchemy.create_engine(DATABASE_URL)

print(DATABASE_URL)
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    const cellContent = notebook.cells[0].content
    const lines = cellContent.split('\n')

    // All lines should start at column 0 (percent format doesn't add function body indentation)
    for (const line of lines) {
      if (line.trim().length > 0) {
        expect(line).toBe(line.trimStart())
      }
    }

    // Verify the content is correct
    expect(cellContent).toContain('import os')
    expect(cellContent).toContain('import sqlalchemy')
  })

  it('preserves relative indentation for nested structures', () => {
    // Test that nested code structures maintain their relative indentation
    const content = `# %%
class MyClass:
    def method(self):
        print("nested")
    def other(self):
        if True:
            print("deeply nested")

obj = MyClass()
`
    const notebook = parsePercentFormat(content)

    expect(notebook.cells).toHaveLength(1)
    const cellContent = notebook.cells[0].content
    const lines = cellContent.split('\n').filter(l => l.length > 0)

    // First line should have no indentation
    expect(lines[0]).toBe('class MyClass:')

    // "def method(self):" should be indented by 4 spaces relative to class
    const methodDefLine = lines.find(l => l.includes('def method'))
    expect(methodDefLine).toBe('    def method(self):')

    // "print(\"nested\")" should be indented by 8 spaces (inside method)
    const printNestedLine = lines.find(l => l.includes('print("nested")'))
    expect(printNestedLine).toBe('        print("nested")')

    // "print(\"deeply nested\")" should be indented by 12 spaces (inside if inside method)
    const printDeeplyNestedLine = lines.find(l => l.includes('print("deeply nested")'))
    expect(printDeeplyNestedLine).toBe('            print("deeply nested")')

    // "obj = MyClass()" should have no indentation (same level as first line)
    const objLine = lines.find(l => l.includes('obj = MyClass'))
    expect(objLine).toBe('obj = MyClass()')
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
    const mockedRandomUUID = getMockedRandomUUID()
    mockedRandomUUID.mockClear()
    mockedRandomUUID.__resetCounter()
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

  it('converts raw cells to markdown blocks with metadata', () => {
    const notebook = {
      cells: [
        {
          cellType: 'raw' as const,
          content: 'Raw content\nNo processing',
        },
      ],
    }

    const blocks = convertPercentNotebookToBlocks(notebook)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[0].content).toBe('Raw content\nNo processing')
    expect(blocks[0].metadata).toHaveProperty('percent_cell_type', 'raw')
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

    expect(blocks[0].sortingKey).toBe('000000')
    expect(blocks[9].sortingKey).toBe('000009')
    expect(blocks[10].sortingKey).toBe('000010')
    expect(blocks[35].sortingKey).toBe('000035')
    expect(blocks[36].sortingKey).toBe('000036')
  })
})

describe('convertPercentFilesToDeepnoteFile', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const mockedRandomUUID = getMockedRandomUUID()
    mockedRandomUUID.mockClear()
    mockedRandomUUID.__resetCounter()
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
        id: test-uuid-002
        initNotebookId: test-uuid-001
        integrations: []
        name: Simple Test
        notebooks:
          - blocks:
              - id: test-uuid-004
                blockGroup: test-uuid-003
                sortingKey: "000000"
                type: markdown
                content: >-
                  # Hello World


                  This is a simple percent format notebook.
                metadata: {}
              - id: test-uuid-006
                blockGroup: test-uuid-005
                sortingKey: "000001"
                type: code
                content: print("Hello, World!")
                metadata: {}
              - id: test-uuid-008
                blockGroup: test-uuid-007
                sortingKey: "000002"
                type: code
                content: >-
                  x = 10

                  y = 20

                  result = x + y

                  print(f"Result: {result}")
                metadata: {}
            executionMode: block
            id: test-uuid-001
            isModule: false
            name: simple.percent
        settings: {}
      version: 1.0.0
      "
    `)
  })
})
