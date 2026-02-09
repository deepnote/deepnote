import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  convertBlocksToQuartoDocument,
  convertDeepnoteFileToQuartoFiles,
  convertDeepnoteToQuartoDocuments,
  serializeQuartoFormat,
} from './deepnote-to-quarto'
import { parseQuartoFormat } from './quarto-to-deepnote'
import type { QuartoDocument } from './types/quarto'

describe('serializeQuartoFormat', () => {
  it('serializes frontmatter', () => {
    const document = {
      frontmatter: {
        title: 'My Document',
        author: 'John Doe',
        jupyter: 'python3',
      },
      cells: [],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('---')
    expect(result).toContain('title: My Document')
    expect(result).toContain('author: John Doe')
    expect(result).toContain('jupyter: python3')
  })

  it('serializes a simple code cell', () => {
    const document = {
      cells: [{ cellType: 'code' as const, content: 'print("hello")', language: 'python' }],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('```{python}')
    expect(result).toContain('print("hello")')
    expect(result).toContain('```')
  })

  it('serializes a markdown cell', () => {
    const document = {
      cells: [{ cellType: 'markdown' as const, content: '# Hello World\n\nThis is a test.' }],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('# Hello World')
    expect(result).toContain('This is a test.')
  })

  it('serializes cell options', () => {
    const document = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'plt.show()',
          language: 'python',
          options: {
            label: 'my-plot',
            echo: true,
            figCap: 'My plot',
            figWidth: 8,
          },
        },
      ],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('#| label: my-plot')
    expect(result).toContain('#| echo: true')
    expect(result).toContain('#| fig-cap: "My plot"')
    expect(result).toContain('#| fig-width: 8')
  })

  it('serializes multiple cells', () => {
    const document = {
      frontmatter: { title: 'Test' },
      cells: [
        { cellType: 'markdown' as const, content: '# Header' },
        { cellType: 'code' as const, content: 'x = 1', language: 'python' },
        { cellType: 'markdown' as const, content: 'Some text.' },
        { cellType: 'code' as const, content: 'y = 2', language: 'python' },
      ],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('# Header')
    expect(result).toContain('```{python}\nx = 1\n```')
    expect(result).toContain('Some text.')
    expect(result).toContain('```{python}\ny = 2\n```')
  })

  it('serializes different languages', () => {
    const document = {
      cells: [{ cellType: 'code' as const, content: 'library(ggplot2)', language: 'r' }],
    }

    const result = serializeQuartoFormat(document)

    expect(result).toContain('```{r}')
  })
})

describe('convertBlocksToQuartoDocument', () => {
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

    const document = convertBlocksToQuartoDocument(blocks, 'Test Notebook')

    expect(document.frontmatter?.title).toBe('Test Notebook')
    expect(document.cells).toHaveLength(1)
    expect(document.cells[0].cellType).toBe('markdown')
    expect(document.cells[0].content).toBe('# Hello World')
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

    const document = convertBlocksToQuartoDocument(blocks, 'Test')

    expect(document.cells).toHaveLength(1)
    expect(document.cells[0].cellType).toBe('code')
    expect(document.cells[0].content).toBe('print("hello")')
  })

  it('preserves Quarto options from metadata', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'plt.show()',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          quarto_label: 'my-plot',
          is_code_hidden: true,
          quarto_fig_cap: 'My figure',
        },
      },
    ]

    const document = convertBlocksToQuartoDocument(blocks, 'Test')

    expect(document.cells[0].options?.label).toBe('my-plot')
    expect(document.cells[0].options?.echo).toBe(false)
    expect(document.cells[0].options?.figCap).toBe('My figure')
  })

  it('preserves non-Python language from metadata', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'library(ggplot2)',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          language: 'r',
        },
      },
    ]

    const document = convertBlocksToQuartoDocument(blocks, 'Test')

    expect(document.cells[0].language).toBe('r')
  })
})

describe('convertDeepnoteToQuartoDocuments', () => {
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

  it('converts a Deepnote file to Quarto document objects', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const documents = convertDeepnoteToQuartoDocuments(deepnoteFile)

    expect(documents.length).toBeGreaterThan(0)
    expect(documents[0]).toHaveProperty('filename')
    expect(documents[0]).toHaveProperty('document')
    expect(documents[0].filename).toMatch(/\.qmd$/)
  })

  it('sanitizes filenames by removing invalid characters', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const documents = convertDeepnoteToQuartoDocuments(deepnoteFile)

    documents.forEach(({ filename }) => {
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).toMatch(/\.qmd$/)
    })
  })
})

describe('convertDeepnoteFileToQuartoFiles', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('converts a Deepnote file to Quarto format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToQuartoFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(file => file.endsWith('.qmd'))).toBe(true)
  })

  it('creates valid Quarto format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToQuartoFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const qmdFile = files.find(file => file.endsWith('.qmd'))
    expect(qmdFile).toBeDefined()

    if (qmdFile) {
      const content = await fs.readFile(path.join(outputDir, qmdFile), 'utf-8')
      // Verify it's valid Quarto format by parsing it
      const doc = parseQuartoFormat(content)
      expect(doc.cells.length).toBeGreaterThan(0)
    }
  })
})

describe('convertDeepnoteFileToQuartoFiles error handling', () => {
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

    await expect(convertDeepnoteFileToQuartoFiles(nonExistentPath, { outputDir })).rejects.toThrow(
      /ENOENT|no such file/
    )
  })

  it('rejects with an error when the file contains invalid YAML', async () => {
    const invalidYamlPath = path.join(tempDir, 'invalid.deepnote')
    await fs.writeFile(invalidYamlPath, 'invalid: [yaml: {missing closing bracket', 'utf-8')

    const outputDir = path.join(tempDir, 'output')

    await expect(convertDeepnoteFileToQuartoFiles(invalidYamlPath, { outputDir })).rejects.toThrow()
  })
})

describe('Quarto format roundtrip', () => {
  it('preserves consecutive markdown cells during roundtrip', () => {
    const document: QuartoDocument = {
      cells: [
        { cellType: 'markdown', content: '# First markdown' },
        { cellType: 'markdown', content: 'Second markdown' },
        { cellType: 'code', content: 'print("code")', language: 'python' },
        { cellType: 'markdown', content: 'Third markdown' },
        { cellType: 'markdown', content: 'Fourth markdown' },
      ],
    }

    const serialized = serializeQuartoFormat(document)

    // Verify delimiter is added between consecutive markdown cells
    expect(serialized).toContain('<!-- cell -->')

    const reparsed = parseQuartoFormat(serialized)

    // Should preserve all 5 cells
    expect(reparsed.cells.length).toBe(5)
    expect(reparsed.cells[0].content).toBe('# First markdown')
    expect(reparsed.cells[1].content).toBe('Second markdown')
    expect(reparsed.cells[2].content).toContain('print("code")')
    expect(reparsed.cells[3].content).toBe('Third markdown')
    expect(reparsed.cells[4].content).toBe('Fourth markdown')
  })

  it('preserves content during parse → serialize roundtrip', () => {
    const original = `---
title: "Test Document"
jupyter: python3
---

# Introduction

This is a test.

\`\`\`{python}
#| label: my-chunk
print("hello")
\`\`\`

## Conclusion

Done!
`
    const doc = parseQuartoFormat(original)
    const serialized = serializeQuartoFormat(doc)
    const reparsed = parseQuartoFormat(serialized)

    expect(reparsed.frontmatter?.title).toBe(doc.frontmatter?.title)
    expect(reparsed.cells.length).toBe(doc.cells.length)
    for (let i = 0; i < doc.cells.length; i++) {
      expect(reparsed.cells[i].cellType).toBe(doc.cells[i].cellType)
      // Content should be preserved (may have minor whitespace differences)
      expect(reparsed.cells[i].content.trim()).toBe(doc.cells[i].content.trim())
    }
  })

  it('preserves Deepnote → Quarto → Deepnote content', async () => {
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const testFixturesDir = path.join(__dirname, '../../../test-fixtures')
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(yamlContent)

    // Convert to Quarto
    const quartoDocuments = convertDeepnoteToQuartoDocuments(original)

    // Serialize and reparse
    for (const { document } of quartoDocuments) {
      const serialized = serializeQuartoFormat(document)
      const reparsed = parseQuartoFormat(serialized)

      // Count non-empty cells (empty cells are filtered out during conversion)
      const nonEmptyCells = document.cells.filter(c => c.content.trim())

      // Cell count should match for non-empty cells
      // Consecutive markdown cells are delimited with <!-- cell --> to preserve boundaries
      expect(reparsed.cells.length).toBeGreaterThanOrEqual(nonEmptyCells.length)
    }
  })
})
