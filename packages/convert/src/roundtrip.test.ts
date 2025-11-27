import fs from 'node:fs/promises'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { convertDeepnoteToJupyterNotebooks } from './deepnote-to-jupyter'
import { convertJupyterNotebooksToDeepnote } from './jupyter-to-deepnote'

describe('roundtrip conversion', () => {
  const testFixturesDir = join(__dirname, '../test-fixtures')

  it('Deepnote → Jupyter → Deepnote preserves notebook content', async () => {
    // 1. Read original Deepnote file
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // 2. Convert to Jupyter
    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // 3. Convert back to Deepnote
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // 4. Compare notebooks (content, not project-level metadata like id, createdAt)
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
