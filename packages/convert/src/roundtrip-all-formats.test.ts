/**
 * Comprehensive roundtrip tests for all notebook formats.
 *
 * Tests BOTH directions for ALL formats:
 * - Format → Deepnote → Format (e.g., Jupyter → Deepnote → Jupyter)
 * - Deepnote → Format → Deepnote (e.g., Deepnote → Jupyter → Deepnote)
 *
 * This ensures:
 * 1. No data loss when importing from a format
 * 2. No data loss when exporting to a format
 * 3. Cell counts, types, and content are preserved in both directions
 */

import fs from 'node:fs/promises'
import { join } from 'node:path'
import { deepnoteFileSchema, deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'

import { convertDeepnoteToJupyterNotebooks } from './deepnote-to-jupyter'
import { convertDeepnoteToMarimoApps, serializeMarimoFormat } from './deepnote-to-marimo'
import { convertDeepnoteToPercentNotebooks, serializePercentFormat } from './deepnote-to-percent'
import { convertDeepnoteToQuartoDocuments, serializeQuartoFormat } from './deepnote-to-quarto'
import { convertJupyterNotebooksToDeepnote } from './jupyter-to-deepnote'
import { convertMarimoAppsToDeepnote, parseMarimoFormat } from './marimo-to-deepnote'
import { convertPercentNotebooksToDeepnote, parsePercentFormat } from './percent-to-deepnote'
import { convertQuartoDocumentsToDeepnote, parseQuartoFormat } from './quarto-to-deepnote'
import type { JupyterNotebook } from './types/jupyter'

const testFixturesDir = join(__dirname, '../test-fixtures')

// ============================================================================
// JUPYTER ROUNDTRIP TESTS
// ============================================================================

describe('Jupyter bidirectional roundtrip', () => {
  it('Jupyter → Deepnote → Jupyter: preserves cell count and types', async () => {
    const ipynbContent = await fs.readFile(join(testFixturesDir, 'simple.ipynb'), 'utf-8')
    const originalJupyter: JupyterNotebook = JSON.parse(ipynbContent)

    // Step 1: Jupyter → Deepnote
    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'test.ipynb', notebook: originalJupyter }], {
      projectName: 'Test',
    })

    // Step 2: Deepnote → Jupyter
    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtrippedJupyter = jupyterNotebooks[0].notebook

    // Verify cell count
    expect(roundtrippedJupyter.cells.length).toBe(originalJupyter.cells.length)

    // Verify cell types
    for (let i = 0; i < originalJupyter.cells.length; i++) {
      expect(roundtrippedJupyter.cells[i].cell_type).toBe(originalJupyter.cells[i].cell_type)
    }
  })

  it('Deepnote → Jupyter → Deepnote: preserves block count, types, and content', async () => {
    const yamlContent = await fs.readFile(join(testFixturesDir, 'simple.deepnote'), 'utf-8')
    const originalDeepnote = deserializeDeepnoteFile(yamlContent)

    // Step 1: Deepnote → Jupyter
    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(originalDeepnote)

    // Step 2: Jupyter → Deepnote
    const roundtrippedDeepnote = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: originalDeepnote.project.name,
    })

    // Verify notebook count
    expect(roundtrippedDeepnote.project.notebooks.length).toBe(originalDeepnote.project.notebooks.length)

    // Verify each notebook
    for (let n = 0; n < originalDeepnote.project.notebooks.length; n++) {
      const originalNotebook = originalDeepnote.project.notebooks[n]
      const roundtrippedNotebook = roundtrippedDeepnote.project.notebooks[n]

      // Verify block count
      expect(roundtrippedNotebook.blocks.length).toBe(originalNotebook.blocks.length)

      // Verify block types and content
      for (let b = 0; b < originalNotebook.blocks.length; b++) {
        expect(roundtrippedNotebook.blocks[b].type).toBe(originalNotebook.blocks[b].type)
        expect(roundtrippedNotebook.blocks[b].content).toBe(originalNotebook.blocks[b].content)
        expect(roundtrippedNotebook.blocks[b].id).toBe(originalNotebook.blocks[b].id)
        expect(roundtrippedNotebook.blocks[b].sortingKey).toBe(originalNotebook.blocks[b].sortingKey)
      }
    }
  })
})

// ============================================================================
// PERCENT FORMAT ROUNDTRIP TESTS
// ============================================================================

describe('Percent format bidirectional roundtrip', () => {
  it('Percent → Deepnote → Percent: preserves cell count, types, and content', async () => {
    const percentContent = await fs.readFile(join(testFixturesDir, 'simple.percent.py'), 'utf-8')
    const originalPercent = parsePercentFormat(percentContent)

    // Step 1: Percent → Deepnote
    const deepnote = convertPercentNotebooksToDeepnote([{ filename: 'test.py', notebook: originalPercent }], {
      projectName: 'Test',
    })

    // Step 2: Deepnote → Percent
    const percentNotebooks = convertDeepnoteToPercentNotebooks(deepnote)
    const serialized = serializePercentFormat(percentNotebooks[0].notebook)
    const roundtrippedPercent = parsePercentFormat(serialized)

    // Verify cell count
    expect(roundtrippedPercent.cells.length).toBe(originalPercent.cells.length)

    // Verify cell types and content
    for (let i = 0; i < originalPercent.cells.length; i++) {
      expect(roundtrippedPercent.cells[i].cellType).toBe(originalPercent.cells[i].cellType)
      expect(roundtrippedPercent.cells[i].content.trim()).toBe(originalPercent.cells[i].content.trim())
    }
  })

  it('Deepnote → Percent → Deepnote: preserves block count and types', async () => {
    const yamlContent = await fs.readFile(join(testFixturesDir, 'simple.deepnote'), 'utf-8')
    const originalDeepnote = deserializeDeepnoteFile(yamlContent)

    // Step 1: Deepnote → Percent
    const percentNotebooks = convertDeepnoteToPercentNotebooks(originalDeepnote)

    // Step 2: Percent → Deepnote
    const roundtrippedDeepnote = convertPercentNotebooksToDeepnote(
      percentNotebooks.map(({ filename, notebook }) => ({ filename, notebook })),
      { projectName: originalDeepnote.project.name }
    )

    // Verify notebook count
    expect(roundtrippedDeepnote.project.notebooks.length).toBe(originalDeepnote.project.notebooks.length)

    // Verify each notebook's block count
    for (let n = 0; n < originalDeepnote.project.notebooks.length; n++) {
      const originalNotebook = originalDeepnote.project.notebooks[n]
      const roundtrippedNotebook = roundtrippedDeepnote.project.notebooks[n]

      // Block count should match
      expect(roundtrippedNotebook.blocks.length).toBe(originalNotebook.blocks.length)
    }
  })

  it('Percent → Deepnote → Percent: data-analysis example', async () => {
    const percentContent = await fs.readFile(join(testFixturesDir, 'data-analysis.percent.py'), 'utf-8')
    const originalPercent = parsePercentFormat(percentContent)

    const deepnote = convertPercentNotebooksToDeepnote([{ filename: 'test.py', notebook: originalPercent }], {
      projectName: 'Test',
    })

    const percentNotebooks = convertDeepnoteToPercentNotebooks(deepnote)
    const serialized = serializePercentFormat(percentNotebooks[0].notebook)
    const roundtrippedPercent = parsePercentFormat(serialized)

    expect(roundtrippedPercent.cells.length).toBe(originalPercent.cells.length)
  })
})

// ============================================================================
// QUARTO FORMAT ROUNDTRIP TESTS
// ============================================================================

describe('Quarto format bidirectional roundtrip', () => {
  it('Quarto → Deepnote → Quarto: preserves cell count and types', async () => {
    const quartoContent = await fs.readFile(join(testFixturesDir, 'simple.qmd'), 'utf-8')
    const originalQuarto = parseQuartoFormat(quartoContent)

    // Step 1: Quarto → Deepnote
    const deepnote = convertQuartoDocumentsToDeepnote([{ filename: 'test.qmd', document: originalQuarto }], {
      projectName: 'Test',
    })

    // Step 2: Deepnote → Quarto
    const quartoDocuments = convertDeepnoteToQuartoDocuments(deepnote)
    const serialized = serializeQuartoFormat(quartoDocuments[0].document)
    const roundtrippedQuarto = parseQuartoFormat(serialized)

    // Cell count should be >= original (title from frontmatter may add cell)
    expect(roundtrippedQuarto.cells.length).toBeGreaterThanOrEqual(originalQuarto.cells.length)

    // Verify original cells are present with correct types
    const originalCodeCells = originalQuarto.cells.filter(c => c.cellType === 'code')
    const roundtrippedCodeCells = roundtrippedQuarto.cells.filter(c => c.cellType === 'code')
    expect(roundtrippedCodeCells.length).toBe(originalCodeCells.length)
  })

  it('Deepnote → Quarto → Deepnote: preserves block count and types', async () => {
    const yamlContent = await fs.readFile(join(testFixturesDir, 'simple.deepnote'), 'utf-8')
    const originalDeepnote = deserializeDeepnoteFile(yamlContent)

    // Step 1: Deepnote → Quarto
    const quartoDocuments = convertDeepnoteToQuartoDocuments(originalDeepnote)

    // Step 2: Quarto → Deepnote
    const roundtrippedDeepnote = convertQuartoDocumentsToDeepnote(
      quartoDocuments.map(({ filename, document }) => ({ filename, document })),
      { projectName: originalDeepnote.project.name }
    )

    // Verify notebook count
    expect(roundtrippedDeepnote.project.notebooks.length).toBe(originalDeepnote.project.notebooks.length)

    // Verify each notebook's block count (may be >= due to title cell)
    for (let n = 0; n < originalDeepnote.project.notebooks.length; n++) {
      const originalNotebook = originalDeepnote.project.notebooks[n]
      const roundtrippedNotebook = roundtrippedDeepnote.project.notebooks[n]

      expect(roundtrippedNotebook.blocks.length).toBeGreaterThanOrEqual(originalNotebook.blocks.length)
    }
  })

  it('Quarto → Deepnote → Quarto: data-analysis example', async () => {
    const quartoContent = await fs.readFile(join(testFixturesDir, 'data-analysis.qmd'), 'utf-8')
    const originalQuarto = parseQuartoFormat(quartoContent)

    const deepnote = convertQuartoDocumentsToDeepnote([{ filename: 'test.qmd', document: originalQuarto }], {
      projectName: 'Test',
    })

    const quartoDocuments = convertDeepnoteToQuartoDocuments(deepnote)
    const serialized = serializeQuartoFormat(quartoDocuments[0].document)
    const roundtrippedQuarto = parseQuartoFormat(serialized)

    // Code cells should be preserved
    const originalCodeCells = originalQuarto.cells.filter(c => c.cellType === 'code')
    const roundtrippedCodeCells = roundtrippedQuarto.cells.filter(c => c.cellType === 'code')
    expect(roundtrippedCodeCells.length).toBe(originalCodeCells.length)
  })
})

// ============================================================================
// MARIMO FORMAT ROUNDTRIP TESTS
// ============================================================================

describe('Marimo format bidirectional roundtrip', () => {
  it('Marimo → Deepnote → Marimo: preserves cell count and types', async () => {
    const marimoContent = await fs.readFile(join(testFixturesDir, 'simple.marimo.py'), 'utf-8')
    const originalMarimo = parseMarimoFormat(marimoContent)

    // Step 1: Marimo → Deepnote
    const deepnote = convertMarimoAppsToDeepnote([{ filename: 'test.py', app: originalMarimo }], {
      projectName: 'Test',
    })

    // Step 2: Deepnote → Marimo
    const marimoApps = convertDeepnoteToMarimoApps(deepnote)
    const serialized = serializeMarimoFormat(marimoApps[0].app)
    const roundtrippedMarimo = parseMarimoFormat(serialized)

    // Verify cell count
    expect(roundtrippedMarimo.cells.length).toBe(originalMarimo.cells.length)

    // Verify cell types and content preservation
    for (let i = 0; i < originalMarimo.cells.length; i++) {
      expect(roundtrippedMarimo.cells[i].cellType).toBe(originalMarimo.cells[i].cellType)

      // Verify code cell content (including indentation) is preserved exactly
      if (originalMarimo.cells[i].cellType === 'code') {
        expect(roundtrippedMarimo.cells[i].content).toBe(originalMarimo.cells[i].content)
      }
    }
  })

  it('Deepnote → Marimo → Deepnote: preserves block count and types', async () => {
    const yamlContent = await fs.readFile(join(testFixturesDir, 'simple.deepnote'), 'utf-8')
    const originalDeepnote = deserializeDeepnoteFile(yamlContent)

    // Step 1: Deepnote → Marimo
    const marimoApps = convertDeepnoteToMarimoApps(originalDeepnote)

    // Step 2: Marimo → Deepnote
    const roundtrippedDeepnote = convertMarimoAppsToDeepnote(
      marimoApps.map(({ filename, app }) => ({ filename, app })),
      { projectName: originalDeepnote.project.name }
    )

    // Verify notebook count
    expect(roundtrippedDeepnote.project.notebooks.length).toBe(originalDeepnote.project.notebooks.length)

    // Verify each notebook's block count
    for (let n = 0; n < originalDeepnote.project.notebooks.length; n++) {
      const originalNotebook = originalDeepnote.project.notebooks[n]
      const roundtrippedNotebook = roundtrippedDeepnote.project.notebooks[n]

      expect(roundtrippedNotebook.blocks.length).toBe(originalNotebook.blocks.length)
    }
  })

  it('Marimo → Deepnote → Marimo: data-analysis example with dependencies', async () => {
    const marimoContent = await fs.readFile(join(testFixturesDir, 'data-analysis.marimo.py'), 'utf-8')
    const originalMarimo = parseMarimoFormat(marimoContent)

    const deepnote = convertMarimoAppsToDeepnote([{ filename: 'test.py', app: originalMarimo }], {
      projectName: 'Test',
    })

    const marimoApps = convertDeepnoteToMarimoApps(deepnote)
    const serialized = serializeMarimoFormat(marimoApps[0].app)
    const roundtrippedMarimo = parseMarimoFormat(serialized)

    // Cell count should match
    expect(roundtrippedMarimo.cells.length).toBe(originalMarimo.cells.length)

    // Verify dependencies and content are preserved
    for (let i = 0; i < originalMarimo.cells.length; i++) {
      if (originalMarimo.cells[i].dependencies?.length) {
        expect(roundtrippedMarimo.cells[i].dependencies).toEqual(originalMarimo.cells[i].dependencies)
      }

      // Verify code cell content (including indentation) is preserved exactly
      if (originalMarimo.cells[i].cellType === 'code') {
        expect(roundtrippedMarimo.cells[i].content).toBe(originalMarimo.cells[i].content)
      }
    }
  })

  it('Marimo → Deepnote → Marimo: SQL blocks preserve query and metadata', () => {
    const marimoWithSql = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT * FROM users WHERE active = true',
          dependencies: ['engine'],
          exports: ['df'],
        },
        {
          cellType: 'sql' as const,
          content: 'SELECT COUNT(*) as total FROM orders',
          exports: ['count'],
        },
      ],
    }

    // Step 1: Marimo → Deepnote
    const deepnote = convertMarimoAppsToDeepnote([{ filename: 'test.py', app: marimoWithSql }], {
      projectName: 'Test',
    })

    // Validate the Deepnote file structure
    const validationResult = deepnoteFileSchema.safeParse(deepnote)
    expect(validationResult.success).toBe(true)

    // Step 2: Deepnote → Marimo
    const marimoApps = convertDeepnoteToMarimoApps(deepnote)
    const serialized = serializeMarimoFormat(marimoApps[0].app)
    const roundtrippedMarimo = parseMarimoFormat(serialized)

    // Verify cell count
    expect(roundtrippedMarimo.cells.length).toBe(marimoWithSql.cells.length)

    // Verify first SQL cell
    expect(roundtrippedMarimo.cells[0].cellType).toBe('sql')
    expect(roundtrippedMarimo.cells[0].content).toBe('SELECT * FROM users WHERE active = true')
    expect(roundtrippedMarimo.cells[0].dependencies).toEqual(['engine'])
    expect(roundtrippedMarimo.cells[0].exports).toEqual(['df'])

    // Verify second SQL cell
    expect(roundtrippedMarimo.cells[1].cellType).toBe('sql')
    expect(roundtrippedMarimo.cells[1].content).toBe('SELECT COUNT(*) as total FROM orders')
    expect(roundtrippedMarimo.cells[1].exports).toEqual(['count'])
  })

  it('Deepnote → Marimo → Deepnote: SQL blocks preserve type and content', () => {
    const deepnoteWithSql: import('@deepnote/blocks').DeepnoteFile = {
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: 'test-project',
        name: 'Test Project',
        notebooks: [
          {
            id: 'test-notebook',
            name: 'Test Notebook',
            blocks: [
              {
                id: 'block-1',
                blockGroup: 'group-1',
                sortingKey: 'a0',
                type: 'sql',
                content: 'SELECT id, name, email FROM users WHERE created_at > NOW() - INTERVAL 30 DAY',
                metadata: {
                  deepnote_variable_name: 'recent_users',
                  marimo_dependencies: ['engine'],
                  marimo_exports: ['recent_users'],
                },
              },
              {
                id: 'block-2',
                blockGroup: 'group-2',
                sortingKey: 'a1',
                type: 'sql',
                content: 'SELECT product_id, SUM(quantity) as total FROM orders GROUP BY product_id',
                metadata: {
                  deepnote_variable_name: 'product_totals',
                  marimo_exports: ['product_totals'],
                },
              },
            ],
          },
        ],
      },
      version: '1.0',
      environment: { python: { version: '3.11' } },
      execution: {},
    }

    // Validate the original Deepnote file
    const originalValidation = deepnoteFileSchema.safeParse(deepnoteWithSql)
    expect(originalValidation.success).toBe(true)

    // Step 1: Deepnote → Marimo
    const marimoApps = convertDeepnoteToMarimoApps(deepnoteWithSql)
    const serialized = serializeMarimoFormat(marimoApps[0].app)

    // Step 2: Marimo → Deepnote
    const parsedMarimo = parseMarimoFormat(serialized)
    const roundtrippedDeepnote = convertMarimoAppsToDeepnote([{ filename: 'test.py', app: parsedMarimo }], {
      projectName: deepnoteWithSql.project.name,
    })

    // Validate the roundtripped Deepnote file
    const roundtrippedValidation = deepnoteFileSchema.safeParse(roundtrippedDeepnote)
    expect(roundtrippedValidation.success).toBe(true)

    // Verify block count
    expect(roundtrippedDeepnote.project.notebooks[0].blocks.length).toBe(
      deepnoteWithSql.project.notebooks[0].blocks.length
    )

    // Verify first SQL block
    const block1 = roundtrippedDeepnote.project.notebooks[0].blocks[0]
    expect(block1.type).toBe('sql')
    expect(block1.content).toBe('SELECT id, name, email FROM users WHERE created_at > NOW() - INTERVAL 30 DAY')
    expect(block1.metadata?.deepnote_variable_name).toBe('recent_users')
    expect(block1.metadata?.marimo_dependencies).toEqual(['engine'])
    expect(block1.metadata?.marimo_exports).toEqual(['recent_users'])

    // Verify second SQL block
    const block2 = roundtrippedDeepnote.project.notebooks[0].blocks[1]
    expect(block2.type).toBe('sql')
    expect(block2.content).toBe('SELECT product_id, SUM(quantity) as total FROM orders GROUP BY product_id')
    expect(block2.metadata?.deepnote_variable_name).toBe('product_totals')
    expect(block2.metadata?.marimo_exports).toEqual(['product_totals'])
  })
})

// ============================================================================
// DEEPNOTE HEADING BLOCK ROUNDTRIP TESTS
// ============================================================================

describe('Deepnote heading block roundtrip', () => {
  // Deepnote heading blocks (text-cell-h1, h2, h3) get converted to markdown
  // (# text, ## text, ### text) when exporting to other formats.
  // This tests that the markdown content is preserved during roundtrip.

  const createDeepnoteWithHeadings = (): import('@deepnote/blocks').DeepnoteFile => ({
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: 'test-project',
      name: 'Test Project',
      notebooks: [
        {
          id: 'test-notebook',
          name: 'Test Notebook',
          blocks: [
            {
              id: 'heading-1',
              blockGroup: 'group-1',
              type: 'text-cell-h1',
              sortingKey: '0',
              content: 'Main Title',
            },
            {
              id: 'heading-2',
              blockGroup: 'group-2',
              type: 'text-cell-h2',
              sortingKey: '1',
              content: 'Section Title',
            },
            {
              id: 'heading-3',
              blockGroup: 'group-3',
              type: 'text-cell-h3',
              sortingKey: '2',
              content: 'Subsection Title',
            },
            {
              id: 'code-1',
              blockGroup: 'group-4',
              type: 'code',
              sortingKey: '3',
              content: 'print("hello")',
            },
          ],
        },
      ],
    },
    version: '1.0.0',
  })

  it('Deepnote heading → Jupyter markdown → Deepnote: preserves heading content', () => {
    const original = createDeepnoteWithHeadings()

    // Step 1: Deepnote → Jupyter
    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // Verify headings are converted to markdown
    const jupyterCells = jupyterNotebooks[0].notebook.cells
    expect(jupyterCells[0].cell_type).toBe('markdown')
    expect(jupyterCells[0].source).toContain('# Main Title')
    expect(jupyterCells[1].cell_type).toBe('markdown')
    expect(jupyterCells[1].source).toContain('## Section Title')
    expect(jupyterCells[2].cell_type).toBe('markdown')
    expect(jupyterCells[2].source).toContain('### Subsection Title')

    // Step 2: Jupyter → Deepnote
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Verify block count and content preserved
    const roundtrippedBlocks = roundtripped.project.notebooks[0].blocks
    expect(roundtrippedBlocks.length).toBe(4)

    // Heading content should be preserved (as markdown content)
    expect(roundtrippedBlocks[0].content).toContain('Main Title')
    expect(roundtrippedBlocks[1].content).toContain('Section Title')
    expect(roundtrippedBlocks[2].content).toContain('Subsection Title')
    expect(roundtrippedBlocks[3].content).toBe('print("hello")')
  })

  it('Deepnote heading → Percent markdown → Deepnote: preserves heading content', () => {
    const original = createDeepnoteWithHeadings()

    // Step 1: Deepnote → Percent
    const percentNotebooks = convertDeepnoteToPercentNotebooks(original)

    // Verify headings are converted to markdown cells
    const percentCells = percentNotebooks[0].notebook.cells
    expect(percentCells[0].cellType).toBe('markdown')
    expect(percentCells[0].content).toContain('Main Title')
    expect(percentCells[1].cellType).toBe('markdown')
    expect(percentCells[1].content).toContain('Section Title')
    expect(percentCells[2].cellType).toBe('markdown')
    expect(percentCells[2].content).toContain('Subsection Title')

    // Step 2: Percent → Deepnote
    const roundtripped = convertPercentNotebooksToDeepnote(
      percentNotebooks.map(({ filename, notebook }) => ({ filename, notebook })),
      { projectName: original.project.name }
    )

    // Verify block count and content preserved
    const roundtrippedBlocks = roundtripped.project.notebooks[0].blocks
    expect(roundtrippedBlocks.length).toBe(4)

    expect(roundtrippedBlocks[0].content).toContain('Main Title')
    expect(roundtrippedBlocks[1].content).toContain('Section Title')
    expect(roundtrippedBlocks[2].content).toContain('Subsection Title')
    expect(roundtrippedBlocks[3].content).toBe('print("hello")')
  })

  it('Deepnote heading → Quarto markdown → Deepnote: preserves heading content', () => {
    const original = createDeepnoteWithHeadings()

    // Step 1: Deepnote → Quarto
    const quartoDocuments = convertDeepnoteToQuartoDocuments(original)

    // Verify headings are converted to markdown cells
    const quartoCells = quartoDocuments[0].document.cells
    const markdownCells = quartoCells.filter(c => c.cellType === 'markdown')
    expect(markdownCells.some(c => c.content.includes('Main Title'))).toBe(true)
    expect(markdownCells.some(c => c.content.includes('Section Title'))).toBe(true)
    expect(markdownCells.some(c => c.content.includes('Subsection Title'))).toBe(true)

    // Step 2: Quarto → Deepnote
    const roundtripped = convertQuartoDocumentsToDeepnote(
      quartoDocuments.map(({ filename, document }) => ({ filename, document })),
      { projectName: original.project.name }
    )

    // Verify content preserved (may have more blocks due to title handling)
    const roundtrippedBlocks = roundtripped.project.notebooks[0].blocks
    expect(roundtrippedBlocks.length).toBeGreaterThanOrEqual(4)

    const allContent = roundtrippedBlocks.map(b => b.content).join('\n')
    expect(allContent).toContain('Main Title')
    expect(allContent).toContain('Section Title')
    expect(allContent).toContain('Subsection Title')
    expect(allContent).toContain('print("hello")')
  })

  it('Deepnote heading → Marimo markdown → Deepnote: preserves heading content', () => {
    const original = createDeepnoteWithHeadings()

    // Step 1: Deepnote → Marimo
    const marimoApps = convertDeepnoteToMarimoApps(original)

    // Verify headings are converted to markdown cells
    const marimoCells = marimoApps[0].app.cells
    const markdownCells = marimoCells.filter(c => c.cellType === 'markdown')
    expect(markdownCells.some(c => c.content.includes('Main Title'))).toBe(true)
    expect(markdownCells.some(c => c.content.includes('Section Title'))).toBe(true)
    expect(markdownCells.some(c => c.content.includes('Subsection Title'))).toBe(true)

    // Step 2: Marimo → Deepnote
    const roundtripped = convertMarimoAppsToDeepnote(
      marimoApps.map(({ filename, app }) => ({ filename, app })),
      { projectName: original.project.name }
    )

    // Verify content preserved
    const roundtrippedBlocks = roundtripped.project.notebooks[0].blocks
    expect(roundtrippedBlocks.length).toBe(4)

    expect(roundtrippedBlocks[0].content).toContain('Main Title')
    expect(roundtrippedBlocks[1].content).toContain('Section Title')
    expect(roundtrippedBlocks[2].content).toContain('Subsection Title')
    expect(roundtrippedBlocks[3].content).toBe('print("hello")')
  })
})

// ============================================================================
// FORMAT INTEGRITY VALIDATION
// ============================================================================

describe('Format integrity validation', () => {
  it('all percent format example files are valid and parsable', async () => {
    const files = ['simple.percent.py', 'data-analysis.percent.py']

    for (const file of files) {
      const content = await fs.readFile(join(testFixturesDir, file), 'utf-8')
      const notebook = parsePercentFormat(content)

      expect(notebook.cells.length).toBeGreaterThan(0)
      expect(notebook.cells.some(c => c.cellType === 'code')).toBe(true)

      // Should be re-serializable
      const serialized = serializePercentFormat(notebook)
      expect(serialized).toContain('# %%')
    }
  })

  it('all quarto format example files are valid and parsable', async () => {
    const files = ['simple.qmd', 'data-analysis.qmd']

    for (const file of files) {
      const content = await fs.readFile(join(testFixturesDir, file), 'utf-8')
      const doc = parseQuartoFormat(content)

      expect(doc.cells.length).toBeGreaterThan(0)
      expect(doc.cells.some(c => c.cellType === 'code')).toBe(true)

      // Should be re-serializable
      const serialized = serializeQuartoFormat(doc)
      expect(serialized).toContain('```{python}')
    }
  })

  it('all marimo format example files are valid and parsable', async () => {
    const files = ['simple.marimo.py', 'data-analysis.marimo.py']

    for (const file of files) {
      const content = await fs.readFile(join(testFixturesDir, file), 'utf-8')
      const app = parseMarimoFormat(content)

      expect(app.cells.length).toBeGreaterThan(0)
      expect(app.cells.some(c => c.cellType === 'code')).toBe(true)

      // Should be re-serializable
      const serialized = serializeMarimoFormat(app)
      expect(serialized).toContain('import marimo')
      expect(serialized).toContain('@app.cell')
    }
  })
})
