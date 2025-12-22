// cspell:ignore roundtripped
import fs from 'node:fs/promises'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
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

describe('Platform-specific Jupyter notebook compatibility', () => {
  it('preserves Google Colab metadata during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'colab-sample.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'colab-sample.ipynb', notebook: original }], {
      projectName: 'Colab Test',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // Verify cell count preserved
    expect(roundtripped.cells.length).toBe(original.cells.length)

    // Verify Colab-specific cell metadata is preserved
    for (let i = 0; i < original.cells.length; i++) {
      const originalCell = original.cells[i]
      const roundtrippedCell = roundtripped.cells[i]

      // Colab cell IDs
      if (originalCell.metadata?.id) {
        expect(roundtrippedCell.metadata?.id).toBe(originalCell.metadata.id)
      }

      // Colab-specific metadata (colab object with base_uri, outputId)
      if (originalCell.metadata?.colab) {
        expect(roundtrippedCell.metadata?.colab).toEqual(originalCell.metadata.colab)
      }

      // Colab form cells (cellView)
      if (originalCell.metadata?.cellView) {
        expect(roundtrippedCell.metadata?.cellView).toBe(originalCell.metadata.cellView)
      }

      // Colab outputId
      if (originalCell.metadata?.outputId) {
        expect(roundtrippedCell.metadata?.outputId).toBe(originalCell.metadata.outputId)
      }
    }
  })

  it('preserves Amazon SageMaker metadata during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'sagemaker-sample.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'sagemaker-sample.ipynb', notebook: original }], {
      projectName: 'SageMaker Test',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // Verify cell count preserved
    expect(roundtripped.cells.length).toBe(original.cells.length)

    // Verify SageMaker-specific cell metadata is preserved
    for (let i = 0; i < original.cells.length; i++) {
      const originalCell = original.cells[i]
      const roundtrippedCell = roundtripped.cells[i]

      // SageMaker tags
      if (originalCell.metadata?.tags) {
        expect(roundtrippedCell.metadata?.tags).toEqual(originalCell.metadata.tags)
      }

      // scrolled setting
      if (originalCell.metadata?.scrolled !== undefined) {
        expect(roundtrippedCell.metadata?.scrolled).toBe(originalCell.metadata.scrolled)
      }
    }
  })

  it('preserves Kaggle metadata during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'kaggle-sample.ipynb')
    const originalJson = await fs.readFile(inputPath, 'utf-8')
    const original: JupyterNotebook = JSON.parse(originalJson)

    const deepnote = convertJupyterNotebooksToDeepnote([{ filename: 'kaggle-sample.ipynb', notebook: original }], {
      projectName: 'Kaggle Test',
    })

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(deepnote)
    const roundtripped = jupyterNotebooks[0].notebook

    // Verify cell count preserved
    expect(roundtripped.cells.length).toBe(original.cells.length)

    // Verify Kaggle-specific cell metadata is preserved
    for (let i = 0; i < original.cells.length; i++) {
      const originalCell = original.cells[i]
      const roundtrippedCell = roundtripped.cells[i]

      // Kaggle UUIDs
      if (originalCell.metadata?._uuid) {
        expect(roundtrippedCell.metadata?._uuid).toBe(originalCell.metadata._uuid)
      }

      // Kaggle cell GUIDs
      if (originalCell.metadata?._cell_guid) {
        expect(roundtrippedCell.metadata?._cell_guid).toBe(originalCell.metadata._cell_guid)
      }

      // Kaggle hide input/output
      if (originalCell.metadata?._kg_hide_input !== undefined) {
        expect(roundtrippedCell.metadata?._kg_hide_input).toBe(originalCell.metadata._kg_hide_input)
      }
      if (originalCell.metadata?._kg_hide_output !== undefined) {
        expect(roundtrippedCell.metadata?._kg_hide_output).toBe(originalCell.metadata._kg_hide_output)
      }

      // Kaggle execution timing
      if (originalCell.metadata?.execution) {
        expect(roundtrippedCell.metadata?.execution).toEqual(originalCell.metadata.execution)
      }
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

describe('Snapshot fields roundtrip', () => {
  it('preserves environment and execution during Deepnote → Jupyter → Deepnote', () => {
    const original: DeepnoteFile = {
      environment: {
        hash: 'sha256:abc123',
        python: {
          version: '3.12.0',
          environment: 'uv',
        },
        platform: 'linux-x86_64',
        packages: {
          pandas: '2.1.0',
          numpy: '1.26.0',
        },
      },
      execution: {
        startedAt: '2025-12-11T10:31:48.441Z',
        finishedAt: '2025-12-11T10:32:15.123Z',
        triggeredBy: 'user',
        inputs: { store: 'NYC-001' },
        summary: {
          blocksExecuted: 2,
          blocksSucceeded: 2,
          blocksFailed: 0,
          totalDurationMs: 27000,
        },
      },
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Test Notebook',
            blocks: [
              {
                id: 'block-1',
                blockGroup: 'group-1',
                type: 'code',
                sortingKey: '0',
                content: 'x = 10',
              },
            ],
          },
        ],
      },
      version: '1.0.0',
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.environment).toEqual(original.environment)
    expect(roundtripped.execution).toEqual(original.execution)
  })

  it('preserves block snapshot fields during Deepnote → Jupyter → Deepnote', () => {
    const original: DeepnoteFile = {
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Test Notebook',
            blocks: [
              {
                id: 'block-1',
                blockGroup: 'group-1',
                type: 'code',
                sortingKey: '0',
                content: 'x = 10',
                contentHash: 'md5:d3b07384d113edec49eaa6238ad5ff00',
                executionStartedAt: '2025-12-11T10:31:45.123Z',
                executionFinishedAt: '2025-12-11T10:31:45.138Z',
              },
              {
                id: 'block-2',
                blockGroup: 'group-2',
                type: 'code',
                sortingKey: '1',
                content: 'y = x * 2',
                contentHash: 'md5:e1671797c52e15f763380b45e841ec32',
                executionStartedAt: '2025-12-11T10:31:45.200Z',
                executionFinishedAt: '2025-12-11T10:31:45.650Z',
              },
            ],
          },
        ],
      },
      version: '1.0.0',
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    const originalBlocks = original.project.notebooks[0].blocks
    const roundtrippedBlocks = roundtripped.project.notebooks[0].blocks

    for (let i = 0; i < originalBlocks.length; i++) {
      expect(roundtrippedBlocks[i].contentHash).toBe(originalBlocks[i].contentHash)
      expect(roundtrippedBlocks[i].executionStartedAt).toBe(originalBlocks[i].executionStartedAt)
      expect(roundtrippedBlocks[i].executionFinishedAt).toBe(originalBlocks[i].executionFinishedAt)
    }
  })

  it('preserves execution error during roundtrip', () => {
    const original: DeepnoteFile = {
      execution: {
        startedAt: '2025-12-11T10:31:48.441Z',
        finishedAt: '2025-12-11T10:32:15.123Z',
        triggeredBy: 'schedule',
        error: {
          name: 'KernelCrash',
          message: 'Kernel died unexpectedly',
          traceback: ['line 1', 'line 2'],
        },
      },
      metadata: {
        createdAt: '2025-01-01T00:00:00Z',
      },
      project: {
        id: 'project-123',
        name: 'Test Project',
        notebooks: [
          {
            id: 'notebook-1',
            name: 'Test Notebook',
            blocks: [],
          },
        ],
      },
      version: '1.0.0',
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.execution?.error).toEqual(original.execution?.error)
  })
})
