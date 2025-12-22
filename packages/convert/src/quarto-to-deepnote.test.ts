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

  it('parses YAML frontmatter with nested objects', () => {
    const content = `---
title: "Complex Document"
format:
  html:
    theme: cosmo
    toc: true
  pdf:
    documentclass: article
execute:
  echo: false
  warning: false
---

# Content here
`
    const doc = parseQuartoFormat(content)

    expect(doc.frontmatter).toBeDefined()
    expect(doc.frontmatter?.title).toBe('Complex Document')
    expect(doc.frontmatter?.format).toEqual({
      html: { theme: 'cosmo', toc: true },
      pdf: { documentclass: 'article' },
    })
    expect(doc.frontmatter?.execute).toEqual({
      echo: false,
      warning: false,
    })
  })

  it('parses YAML frontmatter with arrays', () => {
    const content = `---
title: "Document with Arrays"
authors:
  - name: Alice
    affiliation: University A
  - name: Bob
    affiliation: University B
keywords:
  - data science
  - machine learning
  - python
tags: [tag1, tag2, tag3]
---

# Content here
`
    const doc = parseQuartoFormat(content)

    expect(doc.frontmatter).toBeDefined()
    expect(doc.frontmatter?.title).toBe('Document with Arrays')
    expect(doc.frontmatter?.authors).toEqual([
      { name: 'Alice', affiliation: 'University A' },
      { name: 'Bob', affiliation: 'University B' },
    ])
    expect(doc.frontmatter?.keywords).toEqual(['data science', 'machine learning', 'python'])
    expect(doc.frontmatter?.tags).toEqual(['tag1', 'tag2', 'tag3'])
  })

  it('handles empty YAML frontmatter', () => {
    const content = `---
---

# Content here
`
    const doc = parseQuartoFormat(content)

    expect(doc.frontmatter).toBeDefined()
    expect(Object.keys(doc.frontmatter || {}).length).toBe(0)
  })

  it('handles invalid YAML frontmatter gracefully', () => {
    const content = `---
title: "Unclosed quote
invalid: [unclosed array
---

# Content here
`
    const doc = parseQuartoFormat(content)

    // Should return empty frontmatter on parse error
    expect(doc.frontmatter).toBeDefined()
    expect(Object.keys(doc.frontmatter || {}).length).toBe(0)
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

  it('parses code chunks with hyphenated language identifiers', () => {
    const content = `\`\`\`{python-repl}
>>> print("hello")
hello
\`\`\`

\`\`\`{some-custom-lang}
code here
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(2)
    expect(doc.cells[0].cellType).toBe('code')
    expect(doc.cells[0].language).toBe('python-repl')
    expect(doc.cells[0].content).toBe('>>> print("hello")\nhello')
    expect(doc.cells[1].cellType).toBe('code')
    expect(doc.cells[1].language).toBe('some-custom-lang')
    expect(doc.cells[1].content).toBe('code here')
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

  it('validates option types and preserves malformed values in raw', () => {
    const content = `\`\`\`{python}
#| label: valid-label
#| echo: not-a-boolean
#| fig-width: not-a-number
#| fig-height: 10
#| warning: false
#| custom-option: some-value
print("test")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    expect(doc.cells).toHaveLength(1)
    const options = doc.cells[0].options

    // Valid values should be in typed fields
    expect(options?.label).toBe('valid-label')
    expect(options?.figHeight).toBe(10)
    expect(options?.warning).toBe(false)

    // Invalid values should be in raw
    expect(options?.echo).toBeUndefined()
    expect(options?.figWidth).toBeUndefined()
    expect(options?.raw?.echo).toBe('not-a-boolean')
    expect(options?.raw?.['fig-width']).toBe('not-a-number')

    // Unknown options should be in raw
    expect(options?.raw?.['custom-option']).toBe('some-value')
  })

  it('accepts string representations of booleans', () => {
    const content = `\`\`\`{python}
#| echo: "true"
#| eval: "false"
#| output: true
#| warning: false
print("test")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    const options = doc.cells[0].options
    expect(options?.echo).toBe(true)
    expect(options?.eval).toBe(false)
    expect(options?.output).toBe(true)
    expect(options?.warning).toBe(false)
  })

  it('accepts string representations of numbers', () => {
    const content = `\`\`\`{python}
#| fig-width: "8.5"
#| fig-height: 6
plt.show()
\`\`\`
`
    const doc = parseQuartoFormat(content)

    const options = doc.cells[0].options
    expect(options?.figWidth).toBe(8.5)
    expect(options?.figHeight).toBe(6)
  })

  it('handles edge cases in option values', () => {
    const content = `\`\`\`{python}
#| label: 123
#| echo: maybe
#| fig-width: NaN
#| fig-height: Infinity
print("test")
\`\`\`
`
    const doc = parseQuartoFormat(content)

    const options = doc.cells[0].options

    // Number as label should go to raw (not a string)
    expect(options?.label).toBeUndefined()
    expect(options?.raw?.label).toBe(123)

    // Invalid boolean should go to raw
    expect(options?.echo).toBeUndefined()
    expect(options?.raw?.echo).toBe('maybe')

    // NaN and Infinity strings should go to raw (not valid numbers)
    expect(options?.figWidth).toBeUndefined()
    expect(options?.figHeight).toBeUndefined()
    expect(options?.raw?.['fig-width']).toBe('NaN')
    expect(options?.raw?.['fig-height']).toBe('Infinity')
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
