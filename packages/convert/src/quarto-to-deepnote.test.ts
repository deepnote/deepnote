import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import * as uuid from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertQuartoDocumentToBlocks,
  convertQuartoFilesToDeepnoteFile,
  parseQuartoFormat,
} from './quarto-to-deepnote'

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

describe('parseQuartoFormat', () => {
  it('parses YAML frontmatter', () => {
    const content = `---
title: "My Document"
author: John Doe
jupyter: python3
---

# Content here
`
    const doc = parseQuartoFormat(content)

    expect(doc.frontmatter).toBeDefined()
    expect(doc.frontmatter?.title).toBe('My Document')
    expect(doc.frontmatter?.author).toBe('John Doe')
    expect(doc.frontmatter?.jupyter).toBe('python3')
  })

  it('parses a simple code chunk', () => {
    const content = `# Introduction

\`\`\`{python}
print("hello")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(2)
    expect(doc.cells[0].cellType).toBe('markdown')
    expect(doc.cells[0].content).toBe('# Introduction')
    expect(doc.cells[1].cellType).toBe('code')
    expect(doc.cells[1].content).toBe('print("hello")')
    expect(doc.cells[1].language).toBe('python')
  })

  it('parses code chunks with different languages', () => {
    const content = `\`\`\`{r}
library(ggplot2)
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(1)
    expect(doc.cells[0].cellType).toBe('code')
    expect(doc.cells[0].language).toBe('r')
  })

  it('parses cell options with #| syntax', () => {
    const content = `\`\`\`{python}
#| label: my-chunk
#| echo: false
#| fig-cap: "My figure"
print("hello")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(1)
    expect(doc.cells[0].options).toBeDefined()
    expect(doc.cells[0].options?.label).toBe('my-chunk')
    expect(doc.cells[0].options?.echo).toBe(false)
    expect(doc.cells[0].options?.figCap).toBe('My figure')
    expect(doc.cells[0].content).toBe('print("hello")')
  })

  it('parses numeric options', () => {
    const content = `\`\`\`{python}
#| fig-width: 8
#| fig-height: 6
plt.show()
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells[0].options?.figWidth).toBe(8)
    expect(doc.cells[0].options?.figHeight).toBe(6)
  })

  it('parses multiple cells', () => {
    const content = `---
title: Test
---

# Header

\`\`\`{python}
x = 1
\`\`\`

Some text.

\`\`\`{python}
y = 2
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.frontmatter?.title).toBe('Test')
    expect(doc.cells).toHaveLength(4)
    expect(doc.cells[0].cellType).toBe('markdown')
    expect(doc.cells[1].cellType).toBe('code')
    expect(doc.cells[2].cellType).toBe('markdown')
    expect(doc.cells[3].cellType).toBe('code')
  })

  it('handles empty content', () => {
    const doc = parseQuartoFormat('')

    expect(doc.cells).toHaveLength(0)
    expect(doc.frontmatter).toBeUndefined()
  })

  it('handles content without code chunks', () => {
    const content = `# Just Markdown

This is just markdown content without any code.
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(1)
    expect(doc.cells[0].cellType).toBe('markdown')
  })

  it('parses multiline code cells', () => {
    const content = `\`\`\`{python}
def greet(name):
    """Say hello."""
    return f"Hello, {name}!"

greet("World")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(1)
    expect(doc.cells[0].content).toBe(`def greet(name):
    """Say hello."""
    return f"Hello, {name}!"

greet("World")`)
  })
})

describe('convertQuartoDocumentToBlocks', () => {
  beforeEach(() => {
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
  })

  it('converts a Quarto document to blocks', () => {
    const document = {
      frontmatter: { title: 'My Document' },
      cells: [
        { cellType: 'markdown' as const, content: '# Hello' },
        { cellType: 'code' as const, content: "print('hi')", language: 'python' },
      ],
    }

    const blocks = convertQuartoDocumentToBlocks(document)

    // First block is the title from frontmatter
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[0].content).toBe('# My Document')
    expect(blocks[1].type).toBe('markdown')
    expect(blocks[1].content).toBe('# Hello')
    expect(blocks[2].type).toBe('code')
    expect(blocks[2].content).toBe("print('hi')")
  })

  it('uses custom idGenerator when provided', () => {
    let counter = 0
    const customIdGenerator = () => `custom-id-${++counter}`

    const document = {
      cells: [{ cellType: 'code' as const, content: 'x = 1', language: 'python' }],
    }

    const blocks = convertQuartoDocumentToBlocks(document, {
      idGenerator: customIdGenerator,
    })

    expect(blocks[0].blockGroup).toBe('custom-id-1')
    expect(blocks[0].id).toBe('custom-id-2')
  })

  it('preserves cell options in metadata', () => {
    const document = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'df.head()',
          language: 'python',
          options: {
            label: 'data-preview',
            echo: false,
            figCap: 'Data preview',
          },
        },
      ],
    }

    const blocks = convertQuartoDocumentToBlocks(document)

    expect(blocks[0].metadata).toEqual({
      quarto_label: 'data-preview',
      is_code_hidden: true,
      quarto_fig_cap: 'Data preview',
    })
  })

  it('preserves non-Python language in metadata', () => {
    const document = {
      cells: [{ cellType: 'code' as const, content: 'library(ggplot2)', language: 'r' }],
    }

    const blocks = convertQuartoDocumentToBlocks(document)

    expect(blocks[0].metadata).toEqual({ language: 'r' })
  })
})

describe('convertQuartoFilesToDeepnoteFile', () => {
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

  it('converts a Quarto file to Deepnote', async () => {
    const inputPath = path.join(testFixturesDir, 'simple.qmd')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertQuartoFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.version).toBe('1.0.0')
    expect(result.project.name).toBe('Simple Test')
    expect(result.project.notebooks).toHaveLength(1)

    const notebook = result.project.notebooks[0]
    // Uses title from frontmatter
    expect(notebook.name).toBe('Hello World')
    expect(notebook.blocks.length).toBeGreaterThan(0)
  })

  it('converts the data analysis example', async () => {
    const inputPath = path.join(testFixturesDir, 'data-analysis.qmd')
    const outputPath = path.join(tempDir, 'data-analysis.deepnote')

    await convertQuartoFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Data Analysis',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(1)
    const notebook = result.project.notebooks[0]

    // Check we have the right number of cells
    expect(notebook.blocks.length).toBeGreaterThan(5)

    // Check labels are preserved
    const labeledBlocks = notebook.blocks.filter(b => b.metadata?.quarto_label)
    expect(labeledBlocks.length).toBeGreaterThan(0)
  })

  it('converts multiple Quarto files into one Deepnote file', async () => {
    const inputPaths = [path.join(testFixturesDir, 'simple.qmd'), path.join(testFixturesDir, 'data-analysis.qmd')]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertQuartoFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(2)
  })

  it('matches snapshot for simple.qmd', async () => {
    const inputPath = path.join(testFixturesDir, 'simple.qmd')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertQuartoFilesToDeepnoteFile([inputPath], {
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
                content: "# Hello World"
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: |-
                  # Welcome

                  This is a simple Quarto document.
                id: test-uuid-005
                metadata: {}
                sortingKey: "1"
                type: markdown
              - blockGroup: test-uuid-006
                content: print("Hello, World!")
                id: test-uuid-007
                metadata: {}
                sortingKey: "2"
                type: code
              - blockGroup: test-uuid-008
                content: |-
                  x = 10
                  y = 20
                  result = x + y
                  print(f"Result: {result}")
                id: test-uuid-009
                metadata: {}
                sortingKey: "3"
                type: code
              - blockGroup: test-uuid-010
                content: |-
                  ## Conclusion

                  That's all for now!
                id: test-uuid-011
                metadata: {}
                sortingKey: "4"
                type: markdown
            executionMode: block
            id: test-uuid-012
            isModule: false
            name: Hello World
        settings: {}
      version: 1.0.0
      "
    `)
  })
})
