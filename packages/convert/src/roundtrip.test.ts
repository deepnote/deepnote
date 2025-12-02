// cspell:ignore roundtripped
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
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

  it('preserves project ID during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.id).toBe(original.project.id)
  })

  it('preserves project integrations during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Add test integrations to the original
    original.project.integrations = [
      { id: 'int-1', name: 'PostgreSQL DB', type: 'postgres' },
      { id: 'int-2', name: 'Snowflake DW', type: 'snowflake' },
    ]

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.integrations).toEqual(original.project.integrations)
  })

  it('preserves project settings during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Add test settings to the original
    original.project.settings = {
      environment: { pythonVersion: '3.11', customImage: 'my-image:latest' },
      requirements: ['pandas>=2.0.0', 'numpy>=1.24.0'],
      sqlCacheMaxAge: 3600,
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.settings).toEqual(original.project.settings)
  })

  it('preserves metadata timestamps during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Set test metadata timestamps
    original.metadata.createdAt = '2025-01-15T10:00:00.000Z'
    original.metadata.modifiedAt = '2025-01-20T15:30:00.000Z'
    original.metadata.exportedAt = '2025-01-25T09:00:00.000Z'
    original.metadata.checksum = 'abc123def456'

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.metadata.createdAt).toBe(original.metadata.createdAt)
    expect(roundtripped.metadata.modifiedAt).toBe(original.metadata.modifiedAt)
    expect(roundtripped.metadata.exportedAt).toBe(original.metadata.exportedAt)
    expect(roundtripped.metadata.checksum).toBe(original.metadata.checksum)
  })

  it('preserves initNotebookId during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Set initNotebookId to the first notebook's ID
    original.project.initNotebookId = original.project.notebooks[0]?.id

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.initNotebookId).toBe(original.project.initNotebookId)
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

describe('Edge cases for robust roundtrip', () => {
  it('preserves project metadata even if first notebook is deleted', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Create a second notebook to simulate multi-notebook project
    const secondNotebook = {
      ...original.project.notebooks[0],
      id: 'second-notebook-id',
      name: 'Second Notebook',
    }
    original.project.notebooks.push(secondNotebook)

    // Convert to Jupyter - both notebooks should have project metadata
    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    expect(jupyterNotebooks.length).toBe(2)

    // Simulate first notebook deletion - skip first, use only second
    const withoutFirst = jupyterNotebooks.slice(1)
    expect(withoutFirst.length).toBe(1)

    // Convert back - should still have project metadata from remaining notebook
    const roundtripped = convertJupyterNotebooksToDeepnote(withoutFirst, {
      projectName: original.project.name,
    })

    expect(roundtripped.project.id).toBe(original.project.id)
  })

  it('handles project with zero notebooks gracefully', () => {
    const emptyNotebooks: Array<{ filename: string; notebook: JupyterNotebook }> = []

    const result = convertJupyterNotebooksToDeepnote(emptyNotebooks, {
      projectName: 'Empty Project',
    })

    // Should create valid project with new UUID
    expect(result.project.id).toBeDefined()
    expect(result.project.notebooks).toEqual([])
  })

  it('stores consistent project ID across all notebooks', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // All notebooks should have the same project ID
    const projectIds = jupyterNotebooks.map(n => n.notebook.metadata.deepnote_project_id)
    const uniqueIds = [...new Set(projectIds)]

    expect(uniqueIds.length).toBe(1)
    expect(uniqueIds[0]).toBe(original.project.id)
  })

  it('stores consistent project metadata across all notebooks', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Add test integrations and settings
    original.project.integrations = [{ id: 'int-1', name: 'PostgreSQL DB', type: 'postgres' }]
    original.project.settings = {
      environment: { pythonVersion: '3.11' },
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // All notebooks should have the same integrations and settings
    for (const { notebook } of jupyterNotebooks) {
      expect(notebook.metadata.deepnote_project_integrations).toEqual(original.project.integrations)
      expect(notebook.metadata.deepnote_project_settings).toEqual(original.project.settings)
    }
  })

  it('preserves each notebook individual settings in multi-notebook project', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Ensure we have at least 2 notebooks with DIFFERENT settings
    if (original.project.notebooks.length < 2) {
      const secondNotebook = {
        ...original.project.notebooks[0],
        id: 'second-notebook-unique-id',
        name: 'Second Notebook',
        blocks: [...original.project.notebooks[0].blocks],
      }
      original.project.notebooks.push(secondNotebook)
    }

    // Set DIFFERENT settings for each notebook
    original.project.notebooks[0].executionMode = 'block'
    original.project.notebooks[0].isModule = false
    original.project.notebooks[0].workingDirectory = '/workspace/notebook1'

    original.project.notebooks[1].executionMode = 'downstream'
    original.project.notebooks[1].isModule = true
    original.project.notebooks[1].workingDirectory = '/workspace/notebook2'

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Verify EACH notebook's settings are preserved independently
    expect(roundtripped.project.notebooks[0].executionMode).toBe('block')
    expect(roundtripped.project.notebooks[0].isModule).toBe(false)
    expect(roundtripped.project.notebooks[0].workingDirectory).toBe('/workspace/notebook1')

    expect(roundtripped.project.notebooks[1].executionMode).toBe('downstream')
    expect(roundtripped.project.notebooks[1].isModule).toBe(true)
    expect(roundtripped.project.notebooks[1].workingDirectory).toBe('/workspace/notebook2')
  })

  it('handles empty block content correctly', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Set first block to empty string
    const firstBlock = original.project.notebooks[0]?.blocks[0]
    if (firstBlock) {
      firstBlock.content = ''
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    const roundtrippedBlock = roundtripped.project.notebooks[0]?.blocks[0]
    expect(roundtrippedBlock?.content).toBe('')
  })
})

describe('Additional field preservation', () => {
  it('preserves file version during roundtrip (not hardcoded to 1.0.0)', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Modify version to prove it's not hardcoded
    const customVersion = '2.5.0'
    ;(original as { version: string }).version = customVersion

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    expect(roundtripped.version).toBe(customVersion)
  })

  it('preserves project name automatically without manual parameter', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Set a custom project name
    original.project.name = 'My Custom Project Name'

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // Pass a DIFFERENT project name to prove the metadata takes precedence
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: 'Fallback Name That Should Not Be Used',
    })

    expect(roundtripped.project.name).toBe('My Custom Project Name')
  })

  it('preserves block-level version field during roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Find a block that has a version field, or add one
    const firstBlock = original.project.notebooks[0]?.blocks[0]
    if (firstBlock) {
      ;(firstBlock as { version?: number }).version = 42
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    const roundtrippedBlock = roundtripped.project.notebooks[0]?.blocks[0]
    expect((roundtrippedBlock as { version?: number }).version).toBe(42)
  })

  it('stores file version and project name in Jupyter notebook metadata', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // All notebooks should have file version and project name
    for (const { notebook } of jupyterNotebooks) {
      expect(notebook.metadata.deepnote_file_version).toBe(original.version)
      expect(notebook.metadata.deepnote_project_name).toBe(original.project.name)
    }
  })

  it('stores block version in Jupyter cell metadata', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Add version to a block
    const firstBlock = original.project.notebooks[0]?.blocks[0]
    if (firstBlock) {
      ;(firstBlock as { version?: number }).version = 99
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)

    // First cell should have block version in metadata
    const firstCell = jupyterNotebooks[0]?.notebook.cells[0]
    expect(firstCell?.metadata.deepnote_block_version).toBe(99)
  })

  it('preserves special characters and unicode in project name', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Set project name with special characters and unicode
    const specialName = 'Project™ with "quotes" & unicode: 日本語 émojis: 🚀'
    original.project.name = specialName

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: 'Fallback',
    })

    expect(roundtripped.project.name).toBe(specialName)
  })

  it('preserves special characters in block content', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    // Create content with SQL-like special characters
    const specialContent = `SELECT * FROM "users"
WHERE name = 'O\\'Brien'
  AND status IN ('active', 'pending')
  -- Comment with special chars: <>&"'
  /* Multi-line
     comment */`

    const firstBlock = original.project.notebooks[0]?.blocks[0]
    if (firstBlock) {
      firstBlock.content = specialContent
    }

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    const roundtrippedBlock = roundtripped.project.notebooks[0]?.blocks[0]
    expect(roundtrippedBlock?.content).toBe(specialContent)
  })
})

describe('Semantic equivalence verification', () => {
  it('produces semantically equivalent output after roundtrip', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    // Verify semantic equivalence of all critical fields
    expect(roundtripped.version).toBe(original.version)
    expect(roundtripped.project.id).toBe(original.project.id)
    expect(roundtripped.project.name).toBe(original.project.name)
    expect(roundtripped.metadata.createdAt).toBe(original.metadata.createdAt)
    expect(roundtripped.metadata.modifiedAt).toBe(original.metadata.modifiedAt)
    expect(roundtripped.project.notebooks.length).toBe(original.project.notebooks.length)

    // Compare each notebook
    for (let i = 0; i < original.project.notebooks.length; i++) {
      const origNotebook = original.project.notebooks[i]
      const rtNotebook = roundtripped.project.notebooks[i]

      expect(rtNotebook.id).toBe(origNotebook.id)
      expect(rtNotebook.name).toBe(origNotebook.name)
      expect(rtNotebook.blocks.length).toBe(origNotebook.blocks.length)

      // Compare each block
      for (let j = 0; j < origNotebook.blocks.length; j++) {
        const origBlock = origNotebook.blocks[j]
        const rtBlock = rtNotebook.blocks[j]

        expect(rtBlock.id).toBe(origBlock.id)
        expect(rtBlock.type).toBe(origBlock.type)
        expect(rtBlock.content).toBe(origBlock.content)
        expect(rtBlock.sortingKey).toBe(origBlock.sortingKey)
        expect(rtBlock.blockGroup).toBe(origBlock.blockGroup)
      }
    }
  })

  it('YAML output comparison (informational - shows differences)', async () => {
    const inputPath = join(testFixturesDir, 'ChartExamples.deepnote')
    const originalYaml = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(originalYaml)

    const jupyterNotebooks = convertDeepnoteToJupyterNotebooks(original)
    const roundtripped = convertJupyterNotebooksToDeepnote(jupyterNotebooks, {
      projectName: original.project.name,
    })

    const roundtrippedYaml = stringify(roundtripped)

    // This test documents the current state of YAML differences
    // True byte-for-byte equivalence may not be achievable due to:
    // 1. YAML key ordering
    // 2. Number formatting (1.0 vs 1)
    // 3. String escaping differences
    // 4. Whitespace/newline handling

    // For now, we verify the YAML is valid and can be parsed back
    const reparsed = deserializeDeepnoteFile(roundtrippedYaml)
    expect(reparsed.version).toBe(original.version)
    expect(reparsed.project.id).toBe(original.project.id)

    // Log difference info for debugging (won't affect test pass/fail)
    const originalLines = originalYaml.split('\n').length
    const roundtrippedLines = roundtrippedYaml.split('\n').length

    // These should be close but may not be identical
    expect(Math.abs(originalLines - roundtrippedLines)).toBeLessThan(50)
  })
})
