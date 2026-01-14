import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  convertBlocksToJupyterNotebook,
  convertBlockToJupyterCell,
  convertDeepnoteFileToJupyterFiles,
  convertDeepnoteToJupyterNotebooks,
} from './deepnote-to-jupyter'
import type { JupyterCell } from './types/jupyter'

describe('convertDeepnoteFileToJupyter', () => {
  const testFixturesDir = join(__dirname, '../test-fixtures')
  const testOutputDir = join(__dirname, '../test-output')

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true })
  })

  it('converts a Deepnote file to Jupyter notebooks', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    // Check that the output directory was created
    const stat = await fs.stat(outputDir)
    expect(stat.isDirectory()).toBe(true)

    // Check that notebook files were created
    const files = await fs.readdir(outputDir)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(file => file.endsWith('.ipynb'))).toBe(true)
  })

  it('creates valid Jupyter notebook JSON', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const notebookFile = files.find(file => file.endsWith('.ipynb'))
    expect(notebookFile).toBeDefined()

    if (!notebookFile) {
      throw new Error('No notebook file found')
    }

    const notebookPath = join(outputDir, notebookFile)
    const notebookContent = await fs.readFile(notebookPath, 'utf-8')
    const notebook = JSON.parse(notebookContent)

    // Check Jupyter notebook structure
    expect(notebook).toHaveProperty('cells')
    expect(notebook).toHaveProperty('metadata')
    expect(notebook).toHaveProperty('nbformat')
    expect(notebook).toHaveProperty('nbformat_minor')
    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(0)
    expect(Array.isArray(notebook.cells)).toBe(true)
  })

  it('preserves Deepnote metadata for roundtrip conversion', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const notebookFile = files[0]
    const notebookPath = join(outputDir, notebookFile)
    const notebookContent = await fs.readFile(notebookPath, 'utf-8')
    const notebook = JSON.parse(notebookContent)

    // Check that notebook-level metadata is preserved (flat structure)
    expect(notebook.metadata).toHaveProperty('deepnote_notebook_id')

    // Check that cell-level metadata is preserved (flat structure)
    if (notebook.cells.length > 0) {
      const firstCell = notebook.cells[0]
      expect(firstCell.metadata).toHaveProperty('cell_id')
      expect(firstCell.metadata).toHaveProperty('deepnote_cell_type')
      expect(firstCell.metadata).toHaveProperty('deepnote_sorting_key')
    }
  })

  it('converts code blocks to code cells with outputs', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const notebookPath = join(outputDir, files[0])
    const notebookContent = await fs.readFile(notebookPath, 'utf-8')
    const notebook = JSON.parse(notebookContent)

    const codeCells = notebook.cells.filter((cell: JupyterCell) => cell.cell_type === 'code')
    expect(codeCells.length).toBeGreaterThan(0)

    // Check that code cells have the expected structure
    const codeCell = codeCells[0]
    expect(codeCell).toHaveProperty('execution_count')
    expect(codeCell).toHaveProperty('outputs')
    expect(codeCell).toHaveProperty('source')
    expect(Array.isArray(codeCell.outputs)).toBe(true)
    expect(typeof codeCell.source).toBe('string')
  })

  it('converts markdown blocks to markdown cells', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const notebookPath = join(outputDir, files[0])
    const notebookContent = await fs.readFile(notebookPath, 'utf-8')
    const notebook = JSON.parse(notebookContent)

    const markdownCells = notebook.cells.filter((cell: JupyterCell) => cell.cell_type === 'markdown')
    expect(markdownCells.length).toBeGreaterThan(0)

    // Check that markdown cells have the expected structure
    const markdownCell = markdownCells[0]
    expect(markdownCell).toHaveProperty('source')
    expect(typeof markdownCell.source).toBe('string')
    expect(markdownCell).not.toHaveProperty('outputs')
  })

  it('sanitizes notebook names for filenames', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = join(testOutputDir, 'ChartExamples')

    await convertDeepnoteFileToJupyterFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    // Check that filenames don't contain invalid characters
    files.forEach(file => {
      expect(file).not.toMatch(/[<>:"/\\|?*]/)
    })
  })
})

describe('convertDeepnoteToJupyterNotebooks', () => {
  const testFixturesDir = join(__dirname, '../test-fixtures')

  it('converts a Deepnote file to Jupyter notebook objects without file I/O', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)

    expect(notebooks.length).toBeGreaterThan(0)
    expect(notebooks[0]).toHaveProperty('filename')
    expect(notebooks[0]).toHaveProperty('notebook')
    expect(notebooks[0].filename).toMatch(/\.ipynb$/)
  })

  it('returns valid Jupyter notebook structure', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)
    const { notebook } = notebooks[0]

    expect(notebook).toHaveProperty('cells')
    expect(notebook).toHaveProperty('metadata')
    expect(notebook).toHaveProperty('nbformat')
    expect(notebook).toHaveProperty('nbformat_minor')
    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(0)
    expect(Array.isArray(notebook.cells)).toBe(true)
  })

  it('converts all notebooks in the Deepnote file', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)

    expect(notebooks.length).toBe(deepnoteFile.project.notebooks.length)
  })

  it('sanitizes filenames by removing invalid characters', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)

    notebooks.forEach(({ filename }) => {
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).toMatch(/\.ipynb$/)
    })
  })

  it('preserves Deepnote metadata in notebook objects', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)
    const { notebook } = notebooks[0]

    expect(notebook.metadata).toHaveProperty('deepnote_notebook_id')

    if (notebook.cells.length > 0) {
      const firstCell = notebook.cells[0]
      expect(firstCell.metadata).toHaveProperty('cell_id')
      expect(firstCell.metadata).toHaveProperty('deepnote_cell_type')
      expect(firstCell.metadata).toHaveProperty('deepnote_sorting_key')
    }
  })

  it('converts code and markdown cells correctly', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const notebooks = convertDeepnoteToJupyterNotebooks(deepnoteFile)
    const { notebook } = notebooks[0]

    const codeCells = notebook.cells.filter(cell => cell.cell_type === 'code')
    const markdownCells = notebook.cells.filter(cell => cell.cell_type === 'markdown')

    if (codeCells.length > 0) {
      const codeCell = codeCells[0]
      expect(codeCell).toHaveProperty('execution_count')
      expect(codeCell).toHaveProperty('outputs')
      expect(codeCell).toHaveProperty('source')
      expect(Array.isArray(codeCell.outputs)).toBe(true)
      expect(typeof codeCell.source).toBe('string')
    }

    if (markdownCells.length > 0) {
      const markdownCell = markdownCells[0]
      expect(markdownCell).toHaveProperty('source')
      expect(typeof markdownCell.source).toBe('string')
      // Markdown cells shouldn't have outputs (or they should be undefined)
      expect(markdownCell.outputs).toBeUndefined()
    }
  })
})

describe('convertDeepnoteFileToJupyterFiles error handling', () => {
  const testOutputDir = join(__dirname, '../test-output')

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true })
  })

  it('rejects with a clear error when the .deepnote file does not exist', async () => {
    const nonExistentPath = join(__dirname, '../test-fixtures/does-not-exist.deepnote')
    const outputDir = join(testOutputDir, 'non-existent')

    await expect(convertDeepnoteFileToJupyterFiles(nonExistentPath, { outputDir })).rejects.toThrow(
      /ENOENT|no such file/
    )
  })

  it('rejects with a YAML-related error when the file contains invalid YAML', async () => {
    const invalidYamlPath = join(testOutputDir, 'invalid.deepnote')

    await fs.mkdir(testOutputDir, { recursive: true })
    await fs.writeFile(
      invalidYamlPath,
      `metadata:
  createdAt: 2025-11-24
project:
  name: Test
  notebooks:
    - [invalid yaml: {missing closing bracket`,
      'utf-8'
    )

    const outputDir = join(testOutputDir, 'invalid-output')

    await expect(convertDeepnoteFileToJupyterFiles(invalidYamlPath, { outputDir })).rejects.toThrow()
  })
})

describe('convertBlockToJupyterCell', () => {
  it('converts a code block to a code cell', () => {
    const block: DeepnoteBlock = {
      id: 'code-block',
      type: 'code',
      content: "print('hello')",
      blockGroup: 'group-1',
      sortingKey: '0',
      executionCount: 1,
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
      metadata: {},
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.cell_type).toBe('code')
    expect(cell.source).toBe("print('hello')")
    expect(cell.execution_count).toBe(1)
    expect(cell.outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }])
    expect(cell.metadata.cell_id).toBe('code-block')
    expect(cell.metadata.deepnote_cell_type).toBe('code')
  })

  it('converts a markdown block to a markdown cell', () => {
    const block: DeepnoteBlock = {
      id: 'md-block',
      type: 'markdown',
      content: '# Title\n\nSome text',
      blockGroup: 'group-1',
      sortingKey: '0',
      metadata: {},
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.cell_type).toBe('markdown')
    expect(cell.source).toBe('# Title\n\nSome text')
    expect(cell.metadata.cell_id).toBe('md-block')
    expect(cell.metadata.deepnote_cell_type).toBe('markdown')
    expect(cell.outputs).toBeUndefined()
  })

  it('preserves deepnote_source for roundtrip conversion', () => {
    const block: DeepnoteBlock = {
      id: 'sql-block',
      type: 'sql',
      content: 'SELECT * FROM users',
      blockGroup: 'group-1',
      sortingKey: '0',
      metadata: {},
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.metadata.deepnote_source).toBe('SELECT * FROM users')
    expect(cell.metadata.deepnote_cell_type).toBe('sql')
  })

  it('preserves sorting key and block group', () => {
    const block: DeepnoteBlock = {
      id: 'block-1',
      type: 'code',
      content: 'x = 1',
      blockGroup: 'group-abc',
      sortingKey: '42',
      metadata: {},
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.block_group).toBe('group-abc')
    expect(cell.metadata.deepnote_block_group).toBe('group-abc')
    expect(cell.metadata.deepnote_sorting_key).toBe('42')
  })

  it('produces identical output to convertBlocksToJupyterNotebook for each block', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: '# Hello World',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
      {
        id: 'block-2',
        type: 'code',
        content: "print('hello')",
        blockGroup: 'group-2',
        sortingKey: '1',
        executionCount: 1,
        outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    // Convert each block individually and compare
    const cellsFromIndividualConversion = blocks.map(block => convertBlockToJupyterCell(block))

    expect(cellsFromIndividualConversion).toEqual(notebook.cells)
  })

  it('handles input blocks correctly', () => {
    const block: DeepnoteBlock = {
      id: 'input-text-block',
      type: 'input-text',
      content: '',
      blockGroup: 'group-1',
      sortingKey: '0',
      metadata: {
        deepnote_variable_name: 'text_input',
        deepnote_variable_value: 'hello',
      },
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.cell_type).toBe('code')
    expect(cell.metadata.deepnote_cell_type).toBe('input-text')
    expect(cell.metadata.deepnote_variable_name).toBe('text_input')
    expect(cell.metadata.deepnote_variable_value).toBe('hello')
  })

  it('preserves execution timing metadata', () => {
    const block: DeepnoteBlock = {
      id: 'block-1',
      type: 'code',
      content: 'x = 1',
      blockGroup: 'group-1',
      sortingKey: '0',
      executionStartedAt: '2024-01-01T00:00:00Z',
      executionFinishedAt: '2024-01-01T00:00:01Z',
      contentHash: 'abc123',
      metadata: {},
    }

    const cell = convertBlockToJupyterCell(block)

    expect(cell.metadata.deepnote_execution_started_at).toBe('2024-01-01T00:00:00Z')
    expect(cell.metadata.deepnote_execution_finished_at).toBe('2024-01-01T00:00:01Z')
    expect(cell.metadata.deepnote_content_hash).toBe('abc123')
  })
})

describe('convertBlocksToJupyterNotebook', () => {
  it('converts blocks to a Jupyter notebook', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: '# Hello World',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
      {
        id: 'block-2',
        type: 'code',
        content: "print('hello')",
        blockGroup: 'group-2',
        sortingKey: '1',
        executionCount: 1,
        outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'notebook-123',
      notebookName: 'Test Notebook',
    })

    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(0)
    expect(notebook.metadata.deepnote_notebook_id).toBe('notebook-123')
    expect(notebook.metadata.deepnote_notebook_name).toBe('Test Notebook')
    expect(notebook.cells).toHaveLength(2)
  })

  it('converts markdown blocks to markdown cells', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'md-block',
        type: 'markdown',
        content: '# Title\n\nSome text',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cell_type).toBe('markdown')
    expect(notebook.cells[0].metadata.cell_id).toBe('md-block')
    expect(notebook.cells[0].metadata.deepnote_cell_type).toBe('markdown')
    expect(notebook.cells[0].outputs).toBeUndefined()
  })

  it('converts code blocks to code cells with outputs', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'code-block',
        type: 'code',
        content: 'x = 1',
        blockGroup: 'group-1',
        sortingKey: '0',
        executionCount: 5,
        outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }],
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].execution_count).toBe(5)
    expect(notebook.cells[0].outputs).toEqual([{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }])
  })

  it('converts SQL blocks to code cells', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'sql-block',
        type: 'sql',
        content: 'SELECT * FROM users',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].metadata.deepnote_cell_type).toBe('sql')
  })

  it('includes optional notebook settings in metadata', () => {
    const blocks: DeepnoteBlock[] = []

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
      executionMode: 'downstream',
      isModule: true,
      workingDirectory: '/custom/path',
    })

    expect(notebook.metadata.deepnote_execution_mode).toBe('downstream')
    expect(notebook.metadata.deepnote_is_module).toBe(true)
    expect(notebook.metadata.deepnote_working_directory).toBe('/custom/path')
  })

  it('preserves original content in deepnote_source metadata', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'SELECT * FROM table',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {},
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    expect(notebook.cells[0].metadata.deepnote_source).toBe('SELECT * FROM table')
  })

  it('converts input blocks to code cells', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'input-text-block',
        type: 'input-text',
        content: '',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          deepnote_variable_name: 'text_input',
          deepnote_variable_value: 'hello',
        },
      },
      {
        id: 'input-checkbox-block',
        type: 'input-checkbox',
        content: '',
        blockGroup: 'group-2',
        sortingKey: '1',
        metadata: {
          deepnote_variable_name: 'checkbox_input',
          deepnote_variable_value: true,
        },
      },
      {
        id: 'input-select-block',
        type: 'input-select',
        content: '',
        blockGroup: 'group-3',
        sortingKey: '2',
        metadata: {
          deepnote_variable_name: 'select_input',
          deepnote_variable_value: 'option1',
          deepnote_variable_options: ['option1', 'option2'],
          deepnote_variable_custom_options: [],
          deepnote_variable_selected_variable: '',
          deepnote_variable_select_type: 'from-options',
        },
      },
    ]

    const notebook = convertBlocksToJupyterNotebook(blocks, {
      notebookId: 'nb-1',
      notebookName: 'Test',
    })

    expect(notebook.cells).toHaveLength(3)

    // All input blocks should become code cells
    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].metadata.deepnote_cell_type).toBe('input-text')

    expect(notebook.cells[1].cell_type).toBe('code')
    expect(notebook.cells[1].metadata.deepnote_cell_type).toBe('input-checkbox')

    expect(notebook.cells[2].cell_type).toBe('code')
    expect(notebook.cells[2].metadata.deepnote_cell_type).toBe('input-select')
  })
})
