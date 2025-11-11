import fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertDeepnoteFileToIpynb } from './deepnote-to-jupyter'

describe('convertDeepnoteFileToIpynb', () => {
  const mockOutputDir = '/tmp/test-output'
  let writtenFiles: Map<string, string>

  beforeEach(() => {
    writtenFiles = new Map()

    // Mock fs.mkdir
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)

    // Mock fs.writeFile to capture what would be written
    vi.spyOn(fs, 'writeFile').mockImplementation(async (path, content) => {
      writtenFiles.set(path.toString(), content.toString())
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts a simple Deepnote file with code and markdown blocks', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Test Notebook
      blocks:
        - id: block-1
          type: markdown
          content: '# Hello World'
          sortingKey: a0
          metadata: {}
        - id: block-2
          type: code
          content: 'print("Hello")'
          sortingKey: a1
          executionCount: 1
          metadata: {}
          outputs:
            - output_type: stream
              name: stdout
              text: 'Hello\\n'
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    expect(fs.mkdir).toHaveBeenCalledWith(mockOutputDir, { recursive: true })

    const outputPath = join(mockOutputDir, 'Test Notebook.ipynb')
    expect(writtenFiles.has(outputPath)).toBe(true)

    // biome-ignore lint/style/noNonNullAssertion: Safe in test after verifying file exists
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(0)
    expect(notebook.metadata.deepnote_notebook_id).toBe('notebook-1')
    expect(notebook.cells).toHaveLength(2)

    // Check markdown cell
    expect(notebook.cells[0].cell_type).toBe('markdown')
    expect(notebook.cells[0].source).toBe('# Hello World')
    expect(notebook.cells[0].metadata.cell_id).toBe('block-1')
    expect(notebook.cells[0].metadata.deepnote_cell_type).toBe('markdown')

    // Check code cell
    expect(notebook.cells[1].cell_type).toBe('code')
    expect(notebook.cells[1].source).toBe('print("Hello")')
    expect(notebook.cells[1].execution_count).toBe(1)
    expect(notebook.cells[1].metadata.cell_id).toBe('block-2')
    expect(notebook.cells[1].outputs).toEqual([
      {
        output_type: 'stream',
        name: 'stdout',
        text: 'Hello\\n',
      },
    ])
  })

  it('converts input blocks to code cells with variable assignments', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Input Test
      blocks:
        - id: block-1
          type: input-text
          content: ''
          sortingKey: a0
          metadata:
            deepnote_variable_name: my_input
            deepnote_variable_value: 'test value'
        - id: block-2
          type: input-checkbox
          content: ''
          sortingKey: a1
          metadata:
            deepnote_variable_name: is_enabled
            deepnote_variable_value: true
        - id: block-3
          type: input-slider
          content: ''
          sortingKey: a2
          metadata:
            deepnote_variable_name: my_slider
            deepnote_variable_value: '5'
            deepnote_slider_min_value: 0
            deepnote_slider_max_value: 10
            deepnote_slider_step: 1
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'Input Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells).toHaveLength(3)

    // Input text
    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].source).toContain('my_input')
    expect(notebook.cells[0].source).toContain('test value')

    // Input checkbox
    expect(notebook.cells[1].cell_type).toBe('code')
    expect(notebook.cells[1].source).toContain('is_enabled')
    expect(notebook.cells[1].source).toContain('True')

    // Input slider
    expect(notebook.cells[2].cell_type).toBe('code')
    expect(notebook.cells[2].source).toContain('my_slider')
    expect(notebook.cells[2].source).toContain('5')
  })

  it('converts SQL blocks to code cells with execute_sql calls', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: SQL Test
      blocks:
        - id: block-1
          type: sql
          content: 'SELECT * FROM users'
          sortingKey: a0
          metadata:
            deepnote_variable_name: df_users
            sql_integration_id: sql-integration-123
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'SQL Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells).toHaveLength(1)
    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].source).toContain('df_users')
    expect(notebook.cells[0].source).toContain('_dntk.execute_sql')
    expect(notebook.cells[0].source).toContain('SELECT * FROM users')
  })

  it('converts text blocks to markdown cells', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Text Test
      blocks:
        - id: block-1
          type: text-cell-h1
          content: 'Main Title'
          sortingKey: a0
          metadata: {}
        - id: block-2
          type: text-cell-h2
          content: 'Subtitle'
          sortingKey: a1
          metadata: {}
        - id: block-3
          type: text-cell-p
          content: 'A paragraph of text'
          sortingKey: a2
          metadata: {}
        - id: block-4
          type: text-cell-bullet
          content: 'Bullet point'
          sortingKey: a3
          metadata: {}
        - id: block-5
          type: text-cell-todo
          content: 'Todo item'
          sortingKey: a4
          metadata:
            checked: true
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'Text Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells).toHaveLength(5)

    // H1
    expect(notebook.cells[0].cell_type).toBe('markdown')
    expect(notebook.cells[0].source).toBe('# Main Title')

    // H2
    expect(notebook.cells[1].cell_type).toBe('markdown')
    expect(notebook.cells[1].source).toBe('## Subtitle')

    // Paragraph
    expect(notebook.cells[2].cell_type).toBe('markdown')
    expect(notebook.cells[2].source).toBe('A paragraph of text')

    // Bullet
    expect(notebook.cells[3].cell_type).toBe('markdown')
    expect(notebook.cells[3].source).toBe('- Bullet point')

    // Todo
    expect(notebook.cells[4].cell_type).toBe('markdown')
    expect(notebook.cells[4].source).toBe('- [x] Todo item')
  })

  it('converts separator and image blocks to markdown', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Media Test
      blocks:
        - id: block-1
          type: separator
          content: ''
          sortingKey: a0
          metadata: {}
        - id: block-2
          type: image
          content: ''
          sortingKey: a1
          metadata:
            deepnote_img_src: 'https://example.com/image.png'
            deepnote_img_width: '500'
            deepnote_img_alignment: 'center'
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'Media Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells).toHaveLength(2)

    // Separator
    expect(notebook.cells[0].cell_type).toBe('markdown')
    expect(notebook.cells[0].source).toBe('<hr>')

    // Image
    expect(notebook.cells[1].cell_type).toBe('markdown')
    expect(notebook.cells[1].source).toContain('img src')
    expect(notebook.cells[1].source).toContain('https://example.com/image.png')
    expect(notebook.cells[1].source).toContain('width="500"')
  })

  it('adds "Created in Deepnote" cell when enabled', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-123
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Test
      blocks:
        - id: block-1
          type: code
          content: 'print("test")'
          sortingKey: a0
          metadata: {}
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: true,
    })

    const outputPath = join(mockOutputDir, 'Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells).toHaveLength(2)

    const lastCell = notebook.cells[1]
    expect(lastCell.cell_type).toBe('markdown')
    expect(lastCell.source).toContain('Created in')
    expect(lastCell.source).toContain('Deepnote')
    expect(lastCell.source).toContain('test-project-123')
    expect(lastCell.metadata.created_in_deepnote_cell).toBe(true)
  })

  it('converts multiple notebooks in a project', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: First Notebook
      blocks:
        - id: block-1
          type: code
          content: 'print("first")'
          sortingKey: a0
          metadata: {}
    - id: notebook-2
      name: Second Notebook
      blocks:
        - id: block-2
          type: code
          content: 'print("second")'
          sortingKey: a0
          metadata: {}
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    expect(writtenFiles.size).toBe(2)

    const firstPath = join(mockOutputDir, 'First Notebook.ipynb')
    const secondPath = join(mockOutputDir, 'Second Notebook.ipynb')

    expect(writtenFiles.has(firstPath)).toBe(true)
    expect(writtenFiles.has(secondPath)).toBe(true)

    // biome-ignore lint/style/noNonNullAssertion: Safe in test after verifying files exist
    const firstNotebook = JSON.parse(writtenFiles.get(firstPath)!)
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after verifying files exist
    const secondNotebook = JSON.parse(writtenFiles.get(secondPath)!)

    expect(firstNotebook.cells[0].source).toBe('print("first")')
    expect(secondNotebook.cells[0].source).toBe('print("second")')
  })

  it('handles blocks without outputs gracefully', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Test
      blocks:
        - id: block-1
          type: code
          content: 'x = 1'
          sortingKey: a0
          metadata: {}
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells[0].outputs).toEqual([])
    expect(notebook.cells[0].execution_count).toBe(null)
  })

  it('handles date range input blocks', async () => {
    const mockDeepnoteContent = `
version: 1.0.0
metadata:
  createdAt: '2025-01-01T00:00:00Z'
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Test
      blocks:
        - id: block-1
          type: input-date-range
          content: ''
          sortingKey: a0
          metadata:
            deepnote_variable_name: date_range
            deepnote_variable_value:
              - '2025-01-01'
              - '2025-01-31'
  settings: {}
`

    vi.spyOn(fs, 'readFile').mockResolvedValue(mockDeepnoteContent)

    await convertDeepnoteFileToIpynb('test.deepnote', {
      outputDir: mockOutputDir,
      addCreatedInDeepnoteCell: false,
    })

    const outputPath = join(mockOutputDir, 'Test.ipynb')
    // biome-ignore lint/style/noNonNullAssertion: Safe in test after conversion
    const notebook = JSON.parse(writtenFiles.get(outputPath)!)

    expect(notebook.cells[0].cell_type).toBe('code')
    expect(notebook.cells[0].source).toContain('date_range')
    expect(notebook.cells[0].source).toContain('2025')
  })
})
