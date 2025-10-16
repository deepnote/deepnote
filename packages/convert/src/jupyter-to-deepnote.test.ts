import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import * as uuid from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertIpynbFilesToDeepnoteFile } from './jupyter-to-deepnote'

// Mock uuid to generate predictable IDs for testing
vi.mock('uuid', async () => {
  const actual = await vi.importActual<typeof import('uuid')>('uuid')
  let counter = 0
  return {
    ...actual,
    v4: vi.fn(() => {
      counter++
      return `test-uuid-${counter.toString().padStart(3, '0')}`
    }),
  }
})

describe('createSortingKey', () => {
  // We need to test the internal function via its behavior in the output
  // Since it's not exported, we'll validate sorting keys through conversion tests

  it('generates correct sorting keys for first few indices', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const outputPath = path.join(tempDir, 'test.deepnote')

    try {
      vi.mocked(uuid.v4).mockClear()

      await convertIpynbFilesToDeepnoteFile([path.join(__dirname, '__fixtures__', 'simple.ipynb')], {
        outputPath,
        projectName: 'Test',
      })

      const content = await fs.readFile(outputPath, 'utf-8')
      const result = deserializeDeepnoteFile(content)

      // The sorting keys should be '0', '1', '2' for indices 0, 1, 2
      const sortingKeys = result.project.notebooks[0].blocks.map(b => b.sortingKey)
      expect(sortingKeys).toEqual(['0', '1', '2'])
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('generates correct sorting keys for larger indices', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const outputPath = path.join(tempDir, 'test.deepnote')

    // Create a notebook with many cells to test larger indices
    const notebookWithManyCells = {
      cells: Array.from({ length: 40 }, (_, i) => ({
        cell_type: 'code' as const,
        execution_count: null,
        metadata: {},
        outputs: [],
        source: `# Cell ${i}`,
      })),
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    const inputPath = path.join(tempDir, 'many-cells.ipynb')

    try {
      await fs.writeFile(inputPath, JSON.stringify(notebookWithManyCells), 'utf-8')
      vi.mocked(uuid.v4).mockClear()

      await convertIpynbFilesToDeepnoteFile([inputPath], { outputPath, projectName: 'Test' })

      const content = await fs.readFile(outputPath, 'utf-8')
      const result = deserializeDeepnoteFile(content)

      const sortingKeys = result.project.notebooks[0].blocks.map(b => b.sortingKey)

      // Verify some specific keys (bijective base-36)
      expect(sortingKeys[0]).toBe('0') // index 0
      expect(sortingKeys[9]).toBe('9') // index 9
      expect(sortingKeys[10]).toBe('a') // index 10
      expect(sortingKeys[35]).toBe('z') // index 35
      expect(sortingKeys[36]).toBe('00') // index 36 (wraps to two digits)
      expect(sortingKeys[37]).toBe('01') // index 37

      // Verify all keys are unique
      const uniqueKeys = new Set(sortingKeys)
      expect(uniqueKeys.size).toBe(sortingKeys.length)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('convertIpynbFilesToDeepnoteFile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    // Reset the UUID counter before each test
    vi.mocked(uuid.v4).mockClear()
    // Set a fixed date for deterministic timestamps
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('converts a single Jupyter notebook with markdown and code cells', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    // Verify the file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Read and parse the output
    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify basic structure
    expect(result.version).toBe('1.0.0')
    expect(result.project.name).toBe('Simple Test')
    expect(result.project.notebooks).toHaveLength(1)

    // Verify notebook structure
    const notebook = result.project.notebooks[0]
    expect(notebook.name).toBe('simple')
    expect(notebook.executionMode).toBe('block')
    expect(notebook.blocks).toHaveLength(3)

    // Verify first block (markdown)
    const markdownBlock = notebook.blocks[0]
    expect(markdownBlock.type).toBe('markdown')
    expect(markdownBlock.content).toBe('# Hello World\n\nThis is a test notebook.')
    expect(markdownBlock.outputs).toBeUndefined()

    // Verify second block (code with string source)
    const codeBlock1 = notebook.blocks[1]
    expect(codeBlock1.type).toBe('code')
    expect(codeBlock1.content).toBe("print('Hello World')")
    expect(codeBlock1.executionCount).toBe(1)
    expect(codeBlock1.outputs).toEqual([])

    // Verify third block (code with array source)
    const codeBlock2 = notebook.blocks[2]
    expect(codeBlock2.type).toBe('code')
    expect(codeBlock2.content).toBe('import numpy as np\nimport pandas as pd')
    expect(codeBlock2.executionCount).toBe(2)
  })

  it('handles cells with source as string array', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'array-source.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Array Source Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // The third cell has source as an array
    const block = result.project.notebooks[0].blocks[2]
    expect(block.content).toBe('import numpy as np\nimport pandas as pd')
  })

  it('handles cells with null execution_count', async () => {
    const notebookPath = path.join(tempDir, 'null-execution.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: 'x = 1',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'null-execution.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Null Execution Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.executionCount).toBeUndefined()
  })

  it('converts multiple Jupyter notebooks into one Deepnote file', async () => {
    const inputPaths = [
      path.join(__dirname, '__fixtures__', 'notebook1.ipynb'),
      path.join(__dirname, '__fixtures__', 'notebook2.ipynb'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertIpynbFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify we have two notebooks
    expect(result.project.notebooks).toHaveLength(2)

    // Verify first notebook
    const notebook1 = result.project.notebooks[0]
    expect(notebook1.name).toBe('notebook1')
    expect(notebook1.blocks).toHaveLength(2)
    expect(notebook1.blocks[0].content).toBe('# Notebook 1')
    expect(notebook1.blocks[1].content).toBe('x = 1')

    // Verify second notebook
    const notebook2 = result.project.notebooks[1]
    expect(notebook2.name).toBe('notebook2')
    expect(notebook2.blocks).toHaveLength(2)
    expect(notebook2.blocks[0].content).toBe('# Notebook 2')
    expect(notebook2.blocks[1].content).toBe('y = 2')
  })

  it('converts the real titanic tutorial notebook', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'titanic-tutorial.ipynb')
    const outputPath = path.join(tempDir, 'titanic.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Titanic Tutorial',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify basic structure
    expect(result.project.name).toBe('Titanic Tutorial')
    expect(result.project.notebooks).toHaveLength(1)

    const notebook = result.project.notebooks[0]
    expect(notebook.name).toBe('titanic-tutorial')

    // The titanic notebook should have 15 cells (mix of markdown and code)
    expect(notebook.blocks).toHaveLength(15)

    // Check some specific cells
    const firstCell = notebook.blocks[0]
    expect(firstCell.type).toBe('markdown')
    expect(firstCell.content).toContain('Logging into Kaggle')

    // Find a code cell
    const codeCells = notebook.blocks.filter(b => b.type === 'code')
    expect(codeCells.length).toBeGreaterThan(0)

    // Verify one of the code cells has expected content
    const importCell = codeCells.find(b => b.content?.includes('import numpy as np'))
    expect(importCell).toBeDefined()
    expect(importCell?.content).toContain('import pandas as pd')
  })

  it('generates valid UUIDs for all entities', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'uuids.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'UUID Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Project should have an ID
    expect(result.project.id).toBeTruthy()

    // Each notebook should have an ID
    for (const notebook of result.project.notebooks) {
      expect(notebook.id).toBeTruthy()

      // Each block should have an ID and blockGroup
      for (const block of notebook.blocks) {
        expect(block.id).toBeTruthy()
        expect(block.blockGroup).toBeTruthy()
      }
    }
  })

  it('generates valid ISO timestamp for createdAt', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'timestamp.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Timestamp Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify createdAt is a valid ISO timestamp
    expect(result.metadata.createdAt).toBeTruthy()
    const date = new Date(result.metadata.createdAt)
    expect(date.toISOString()).toBe(result.metadata.createdAt)
  })

  it('writes output as valid YAML', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'yaml.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'YAML Test',
    })

    // Read the raw content
    const content = await fs.readFile(outputPath, 'utf-8')

    // Verify it starts with expected YAML structure
    expect(content).toContain('metadata:')
    expect(content).toContain('project:')
    expect(content).toContain('version:')

    // Verify it can be parsed by deserializeDeepnoteFile
    expect(() => deserializeDeepnoteFile(content)).not.toThrow()
  })

  it('preserves notebook outputs for code cells', async () => {
    const notebookPath = path.join(tempDir, 'with-outputs.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: ['Hello World\n'],
            },
          ],
          source: "print('Hello World')",
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'with-outputs.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Outputs Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.outputs).toBeDefined()
    expect(block.outputs).toHaveLength(1)
    expect(block.outputs?.[0]).toEqual({
      output_type: 'stream',
      name: 'stdout',
      text: ['Hello World\n'],
    })
  })

  it('does not include outputs for markdown cells', async () => {
    const notebookPath = path.join(tempDir, 'markdown-only.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: '# Title',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'markdown-only.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Markdown Only Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.type).toBe('markdown')
    expect(block.outputs).toBeUndefined()
  })
})

describe('snapshot tests - exact YAML output format', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    // Reset the UUID counter before each test
    vi.mocked(uuid.v4).mockClear()
    // Set a fixed date for deterministic timestamps
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('matches snapshot for simple.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchSnapshot()
  })

  it('matches snapshot for notebook1.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'notebook1.ipynb')
    const outputPath = path.join(tempDir, 'notebook1.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Notebook 1',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchSnapshot()
  })

  it('matches snapshot for notebook2.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'notebook2.ipynb')
    const outputPath = path.join(tempDir, 'notebook2.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Notebook 2',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchSnapshot()
  })

  it('matches snapshot for titanic-tutorial.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'titanic-tutorial.ipynb')
    const outputPath = path.join(tempDir, 'titanic.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Titanic Tutorial',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchSnapshot()
  })

  it('matches snapshot for multiple notebooks', async () => {
    const inputPaths = [
      path.join(__dirname, '__fixtures__', 'notebook1.ipynb'),
      path.join(__dirname, '__fixtures__', 'notebook2.ipynb'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertIpynbFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchSnapshot()
  })
})
