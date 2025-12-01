// cspell:ignore roundtripped
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { convertDeepnoteToJupyterNotebooks } from './deepnote-to-jupyter'
import { convertJupyterNotebooksToDeepnote } from './jupyter-to-deepnote'
import type { JupyterNotebook } from './types/jupyter'

const testFixturesDir = join(__dirname, '../test-fixtures')

describe('Deepnote → Jupyter → Deepnote roundtrip', () => {
  it('preserves notebook content', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.notebooks).toEqual(original.project.notebooks)
  })

  it('preserves notebook IDs during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Notebook IDs should be preserved
    const originalIds = original.project.notebooks.map(n => n.id)
    const roundtrippedIds = roundtripped.project.notebooks.map(n => n.id)

    expect(roundtrippedIds).toEqual(originalIds)
  })

  it('preserves block IDs and sorting keys during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Compare block IDs and sorting keys for each notebook
    for (let i = 0; i < original.project.notebooks.length; i++) {
      const originalBlocks = original.project.notebooks[i].blocks
      const roundtrippedBlocks = roundtripped.project.notebooks[i].blocks

      expect(roundtrippedBlocks.length).toBe(originalBlocks.length)

      for (let j = 0; j < originalBlocks.length; j++) {
        expect(roundtrippedBlocks[j].id).toBe(originalBlocks[j].id)
        expect(roundtrippedBlocks[j].sortingKey).toBe(originalBlocks[j].sortingKey)
        expect(roundtrippedBlocks[j].blockGroup).toBe(originalBlocks[j].blockGroup)
      }
    }
  })

  it('preserves block content during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Compare block content for each notebook
    for (let i = 0; i < original.project.notebooks.length; i++) {
      const originalBlocks = original.project.notebooks[i].blocks
      const roundtrippedBlocks = roundtripped.project.notebooks[i].blocks

      for (let j = 0; j < originalBlocks.length; j++) {
        expect(roundtrippedBlocks[j].content).toBe(originalBlocks[j].content)
        expect(roundtrippedBlocks[j].type).toBe(originalBlocks[j].type)
      }
    }
  })

  it('preserves notebook execution settings during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    for (let i = 0; i < original.project.notebooks.length; i++) {
      const originalNotebook = original.project.notebooks[i]
      const roundtrippedNotebook = roundtripped.project.notebooks[i]

      expect(roundtrippedNotebook.executionMode).toBe(originalNotebook.executionMode)
      expect(roundtrippedNotebook.isModule).toBe(originalNotebook.isModule)
      expect(roundtrippedNotebook.workingDirectory).toBe(originalNotebook.workingDirectory)
    }
  })
})

describe('Jupyter → Deepnote → Jupyter roundtrip', () => {
  it('preserves cell count and types', async () => {
    const inputPath = join(testFixturesDir, 'titanic-tutorial.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'titanic-tutorial.ipynb', notebook: original }], {
      projectName: 'Test Project',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    expect(roundtripped.cells.length).toBe(original.cells.length)

    for (let i = 0; i < original.cells.length; i++) {
      expect(roundtripped.cells[i].cell_type).toBe(original.cells[i].cell_type)
    }
  })

  it('preserves cell source content via deepnote_source metadata', async () => {
    const inputPath = join(testFixturesDir, 'titanic-tutorial.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'titanic-tutorial.ipynb', notebook: original }], {
      projectName: 'Test Project',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // The roundtrip preserves original source in deepnote_source metadata
    // which allows lossless conversion back to Deepnote
    for (let i = 0; i < original.cells.length; i++) {
      const cellSource = original.cells[i].source
      const originalSource = Array.isArray(cellSource) ? cellSource.join('') : cellSource

      // Original content is preserved in deepnote_source metadata
      const preservedSource = roundtripped.cells[i].metadata?.deepnote_source as string

      expect(preservedSource).toBe(originalSource)
    }
  })

  it('plain code cells preserve source without DataFrame config', async () => {
    const inputPath = join(testFixturesDir, 'titanic-tutorial.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'titanic-tutorial.ipynb', notebook: original }], {
      projectName: 'Test Project',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // Plain code cells should NOT have DataFrame config prepended
    // (only Deepnote-specific blocks like SQL, visualization, etc. get the config)
    for (let i = 0; i < original.cells.length; i++) {
      if (original.cells[i].cell_type === 'code') {
        const cellSource = original.cells[i].source
        const originalSource = Array.isArray(cellSource) ? cellSource.join('') : cellSource
        const rtSource = roundtripped.cells[i].source
        const roundtrippedSource = Array.isArray(rtSource) ? rtSource.join('') : rtSource

        // Should NOT include DataFrame config for plain code blocks
        expect(roundtrippedSource).not.toContain("if '_dntk' in globals():")

        // Should match original source exactly
        expect(roundtrippedSource).toBe(originalSource)
      }
    }
  })

  it('preserves cell outputs', async () => {
    const inputPath = join(testFixturesDir, 'titanic-tutorial.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'titanic-tutorial.ipynb', notebook: original }], {
      projectName: 'Test Project',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // Compare outputs for code cells
    for (let i = 0; i < original.cells.length; i++) {
      if (original.cells[i].cell_type === 'code' && original.cells[i].outputs) {
        expect(roundtripped.cells[i].outputs).toEqual(original.cells[i].outputs)
      }
    }
  })
})
