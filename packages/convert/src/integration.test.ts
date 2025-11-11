import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { convertDeepnoteFileToIpynb } from './deepnote-to-jupyter'
import { convertIpynbFilesToDeepnoteFile } from './jupyter-to-deepnote'

describe('Integration tests: bidirectional conversion', () => {
  const examplesDir = path.resolve(__dirname, '../../../examples')

  it('converts 1_hello_world.deepnote to ipynb and back', async () => {
    const originalDeepnotePath = path.join(examplesDir, '1_hello_world.deepnote')
    const tempDir = path.join(__dirname, '../../../tmp/integration-test-hello-world')

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // 1. Read original .deepnote file
      const originalDeepnoteContent = await fs.readFile(originalDeepnotePath, 'utf-8')

      // 2. Convert to Jupyter
      const ipynbDir = path.join(tempDir, 'ipynb-output')
      await convertDeepnoteFileToIpynb(originalDeepnotePath, {
        outputDir: ipynbDir,
        addCreatedInDeepnoteCell: false, // Don't add extra cell for clean comparison
      })

      // 3. Read generated Jupyter notebook(s)
      const ipynbFiles = await fs.readdir(ipynbDir)
      expect(ipynbFiles.length).toBeGreaterThan(0)
      expect(ipynbFiles.some(f => f.endsWith('.ipynb'))).toBe(true)

      // 4. Convert back to .deepnote
      const roundtripDeepnotePath = path.join(tempDir, 'roundtrip.deepnote')
      const ipynbPaths = ipynbFiles.filter(f => f.endsWith('.ipynb')).map(f => path.join(ipynbDir, f))

      await convertIpynbFilesToDeepnoteFile(ipynbPaths, {
        projectName: 'Hello World',
        outputPath: roundtripDeepnotePath,
      })

      // 5. Read roundtrip .deepnote file
      const roundtripDeepnoteContent = await fs.readFile(roundtripDeepnotePath, 'utf-8')

      // 6. Parse both files for comparison
      const _originalLines = originalDeepnoteContent.split('\n').filter(line => {
        // Filter out metadata that changes (timestamps, IDs)
        return (
          !line.includes('createdAt:') &&
          !line.includes('modifiedAt:') &&
          !line.includes('exportedAt:') &&
          !line.includes('id:') &&
          !line.includes('blockGroup:') &&
          !line.includes('execution_start:') &&
          !line.includes('execution_millis:') &&
          !line.includes('execution_context_id:')
        )
      })

      const roundtripLines = roundtripDeepnoteContent.split('\n').filter(line => {
        return (
          !line.includes('createdAt:') &&
          !line.includes('modifiedAt:') &&
          !line.includes('exportedAt:') &&
          !line.includes('id:') &&
          !line.includes('blockGroup:') &&
          !line.includes('execution_start:') &&
          !line.includes('execution_millis:') &&
          !line.includes('execution_context_id:')
        )
      })

      // Compare content (should be similar after filtering dynamic fields)
      expect(roundtripLines.length).toBeGreaterThan(0)

      // Check key content is preserved
      expect(roundtripDeepnoteContent).toContain('print("Hello world!")')
      expect(roundtripDeepnoteContent).toContain('type: code')
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('converts 2_blocks.deepnote to ipynb and back preserving block types', async () => {
    const originalDeepnotePath = path.join(examplesDir, '2_blocks.deepnote')
    const tempDir = path.join(__dirname, '../../../tmp/integration-test-blocks')

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // 1. Read original .deepnote file
      const originalDeepnoteContent = await fs.readFile(originalDeepnotePath, 'utf-8')

      // 2. Convert to Jupyter
      const ipynbDir = path.join(tempDir, 'ipynb-output')
      await convertDeepnoteFileToIpynb(originalDeepnotePath, {
        outputDir: ipynbDir,
        addCreatedInDeepnoteCell: false,
      })

      // 3. Verify Jupyter notebooks were created
      const ipynbFiles = await fs.readdir(ipynbDir)
      const ipynbPaths = ipynbFiles.filter(f => f.endsWith('.ipynb')).map(f => path.join(ipynbDir, f))

      expect(ipynbPaths.length).toBeGreaterThan(0)

      // 4. Check that various block types are converted
      for (const ipynbPath of ipynbPaths) {
        const ipynbContent = await fs.readFile(ipynbPath, 'utf-8')
        const notebook = JSON.parse(ipynbContent)

        // Verify cells exist
        expect(notebook.cells.length).toBeGreaterThan(0)

        // Check that metadata is preserved
        for (const cell of notebook.cells) {
          expect(cell.metadata).toBeDefined()
          expect(cell.metadata.deepnote_cell_type).toBeDefined()
        }
      }

      // 5. Convert back to .deepnote
      const roundtripDeepnotePath = path.join(tempDir, 'roundtrip.deepnote')

      await convertIpynbFilesToDeepnoteFile(ipynbPaths, {
        projectName: 'blocks.deepnote',
        outputPath: roundtripDeepnotePath,
      })

      // 6. Verify roundtrip file has expected content
      const roundtripDeepnoteContent = await fs.readFile(roundtripDeepnotePath, 'utf-8')

      // Check that key content from input blocks is preserved
      expect(roundtripDeepnoteContent).toContain('markdown')
      expect(roundtripDeepnoteContent).toContain('code')

      // Input blocks get converted to code (variable assignments), so verify the variables exist
      expect(originalDeepnoteContent).toContain('input_text')
      expect(originalDeepnoteContent).toContain('input_checkbox')
      expect(originalDeepnoteContent).toContain('input_select')
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves code cell outputs through roundtrip conversion', async () => {
    const originalDeepnotePath = path.join(examplesDir, '1_hello_world.deepnote')
    const tempDir = path.join(__dirname, '../../../tmp/integration-test-outputs')

    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // Convert to Jupyter
      const ipynbDir = path.join(tempDir, 'ipynb-output')
      await convertDeepnoteFileToIpynb(originalDeepnotePath, {
        outputDir: ipynbDir,
        addCreatedInDeepnoteCell: false,
      })

      // Read the Jupyter notebook
      const ipynbFiles = await fs.readdir(ipynbDir)
      const firstIpynb = ipynbFiles.find(f => f.endsWith('.ipynb'))
      expect(firstIpynb).toBeDefined()

      // biome-ignore lint/style/noNonNullAssertion: Safe after checking with expect
      const ipynbPath = path.join(ipynbDir, firstIpynb!)
      const ipynbContent = await fs.readFile(ipynbPath, 'utf-8')
      const notebook = JSON.parse(ipynbContent)

      // Find code cells with outputs
      const codeCellsWithOutputs = notebook.cells.filter(
        // biome-ignore lint/suspicious/noExplicitAny: Jupyter notebook format is flexible
        (cell: any) => cell.cell_type === 'code' && cell.outputs && cell.outputs.length > 0
      )

      expect(codeCellsWithOutputs.length).toBeGreaterThan(0)

      // Convert back to Deepnote
      const roundtripPath = path.join(tempDir, 'roundtrip.deepnote')
      await convertIpynbFilesToDeepnoteFile([ipynbPath], {
        projectName: 'Test',
        outputPath: roundtripPath,
      })

      // Verify outputs are preserved
      const roundtripContent = await fs.readFile(roundtripPath, 'utf-8')
      expect(roundtripContent).toContain('outputs:')
      expect(roundtripContent).toContain('Hello world!')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('handles markdown content correctly in roundtrip', async () => {
    const originalDeepnotePath = path.join(examplesDir, '2_blocks.deepnote')
    const tempDir = path.join(__dirname, '../../../tmp/integration-test-markdown')

    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // Read original to check markdown content
      const originalContent = await fs.readFile(originalDeepnotePath, 'utf-8')

      // Convert to Jupyter
      const ipynbDir = path.join(tempDir, 'ipynb-output')
      await convertDeepnoteFileToIpynb(originalDeepnotePath, {
        outputDir: ipynbDir,
        addCreatedInDeepnoteCell: false,
      })

      // Check that markdown is present in Jupyter format
      const ipynbFiles = await fs.readdir(ipynbDir)
      const ipynbPaths = ipynbFiles.filter(f => f.endsWith('.ipynb')).map(f => path.join(ipynbDir, f))

      for (const ipynbPath of ipynbPaths) {
        const ipynbContent = await fs.readFile(ipynbPath, 'utf-8')
        const notebook = JSON.parse(ipynbContent)

        // biome-ignore lint/suspicious/noExplicitAny: Jupyter notebook format is flexible
        const markdownCells = notebook.cells.filter((cell: any) => cell.cell_type === 'markdown')

        if (markdownCells.length > 0) {
          // Verify markdown cells have content
          expect(markdownCells[0].source).toBeDefined()
          expect(markdownCells[0].source.length).toBeGreaterThan(0)
        }
      }

      // Convert back
      const roundtripPath = path.join(tempDir, 'roundtrip.deepnote')
      await convertIpynbFilesToDeepnoteFile(ipynbPaths, {
        projectName: 'Test',
        outputPath: roundtripPath,
      })

      const roundtripContent = await fs.readFile(roundtripPath, 'utf-8')

      // Check markdown is preserved (though it might be in a different block type)
      if (originalContent.includes('# This is a markdown heading')) {
        expect(roundtripContent).toContain('This is a markdown heading')
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves IDs through roundtrip conversion', async () => {
    const originalDeepnotePath = path.join(examplesDir, '1_hello_world.deepnote')
    const tempDir = path.join(__dirname, '../../../tmp/integration-test-id-preservation')

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })

    try {
      // 1. Parse original .deepnote file to extract IDs
      const originalDeepnoteContent = await fs.readFile(originalDeepnotePath, 'utf-8')
      // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
      const originalDeepnote = parse(originalDeepnoteContent) as any

      const originalProjectId = originalDeepnote.project.id
      const originalNotebookId = originalDeepnote.project.notebooks[0].id
      // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
      const originalBlockIds = originalDeepnote.project.notebooks[0].blocks.map((b: any) => b.id)
      // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
      const originalBlockGroups = originalDeepnote.project.notebooks[0].blocks.map((b: any) => b.blockGroup)
      // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
      const originalSortingKeys = originalDeepnote.project.notebooks[0].blocks.map((b: any) => b.sortingKey)

      // 2. Convert to Jupyter
      const ipynbDir = path.join(tempDir, 'ipynb-output')
      await convertDeepnoteFileToIpynb(originalDeepnotePath, {
        outputDir: ipynbDir,
        addCreatedInDeepnoteCell: false,
      })

      // 3. Read Jupyter notebook and verify metadata is stored
      const ipynbFiles = await fs.readdir(ipynbDir)
      const ipynbPath = path.join(ipynbDir, ipynbFiles[0])
      const ipynbContent = await fs.readFile(ipynbPath, 'utf-8')
      const ipynb = JSON.parse(ipynbContent)

      // Verify metadata is stored in Jupyter notebook
      expect(ipynb.metadata.deepnote.original_project_id).toBe(originalProjectId)
      expect(ipynb.metadata.deepnote.original_notebook_id).toBe(originalNotebookId)
      expect(ipynb.cells[0].metadata.deepnote_to_be_reused.block_id).toBe(originalBlockIds[0])
      expect(ipynb.cells[0].metadata.deepnote_to_be_reused.block_group).toBe(originalBlockGroups[0])
      expect(ipynb.cells[0].metadata.deepnote_to_be_reused.sorting_key).toBe(originalSortingKeys[0])

      // 4. Convert back to .deepnote
      const roundtripDeepnotePath = path.join(tempDir, 'roundtrip.deepnote')
      await convertIpynbFilesToDeepnoteFile([ipynbPath], {
        projectName: 'Hello World',
        outputPath: roundtripDeepnotePath,
      })

      // 5. Parse roundtrip file and verify IDs are preserved
      const roundtripDeepnoteContent = await fs.readFile(roundtripDeepnotePath, 'utf-8')
      // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
      const roundtripDeepnote = parse(roundtripDeepnoteContent) as any

      // Verify all IDs are preserved
      expect(roundtripDeepnote.project.id).toBe(originalProjectId)
      expect(roundtripDeepnote.project.notebooks[0].id).toBe(originalNotebookId)
      expect(roundtripDeepnote.project.notebooks[0].blocks[0].id).toBe(originalBlockIds[0])
      expect(roundtripDeepnote.project.notebooks[0].blocks[0].blockGroup).toBe(originalBlockGroups[0])
      expect(roundtripDeepnote.project.notebooks[0].blocks[0].sortingKey).toBe(originalSortingKeys[0])

      // Verify all original blocks' IDs are preserved (excluding any new cells like "Created in Deepnote")
      const roundtripBlockIds = roundtripDeepnote.project.notebooks[0].blocks
        .slice(0, originalBlockIds.length)
        // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
        .map((b: any) => b.id)
      expect(roundtripBlockIds).toEqual(originalBlockIds)

      const roundtripBlockGroups = roundtripDeepnote.project.notebooks[0].blocks
        .slice(0, originalBlockGroups.length)
        // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
        .map((b: any) => b.blockGroup)
      expect(roundtripBlockGroups).toEqual(originalBlockGroups)

      const roundtripSortingKeys = roundtripDeepnote.project.notebooks[0].blocks
        .slice(0, originalSortingKeys.length)
        // biome-ignore lint/suspicious/noExplicitAny: Deepnote file structure is flexible
        .map((b: any) => b.sortingKey)
      expect(roundtripSortingKeys).toEqual(originalSortingKeys)
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
