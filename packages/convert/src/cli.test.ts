import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { convert } from './cli'

describe('CLI convert function', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-cli-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('converts a single notebook file', async () => {
    // Create a test notebook
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: '# Test Notebook',
        },
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          outputs: [],
          source: 'print("hello")',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Run convert
    const outputPath = await convert({
      inputPath: notebookPath,
      cwd: tempDir,
    })

    // Check that the output file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify the content
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('test')
    expect(parsed.project.notebooks).toHaveLength(1)
    expect(parsed.project.notebooks[0].blocks).toHaveLength(2)
  })

  it('converts a directory with multiple notebooks', async () => {
    // Create test notebooks
    const notebook1 = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Notebook 1' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    const notebook2 = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Notebook 2' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    const notebooksDir = path.join(tempDir, 'notebooks')
    await fs.mkdir(notebooksDir)
    await fs.writeFile(path.join(notebooksDir, 'nb1.ipynb'), JSON.stringify(notebook1), 'utf-8')
    await fs.writeFile(path.join(notebooksDir, 'nb2.ipynb'), JSON.stringify(notebook2), 'utf-8')

    // Run convert
    const outputPath = await convert({
      inputPath: notebooksDir,
      cwd: tempDir,
    })

    // Check output file
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify content
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.notebooks).toHaveLength(2)
  })

  it('supports custom projectName', async () => {
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Run convert with custom project name
    const outputPath = await convert({
      inputPath: notebookPath,
      projectName: 'Custom Project',
      cwd: tempDir,
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('Custom Project')
  })

  it('supports custom outputPath as file path', async () => {
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const customOutputPath = path.join(tempDir, 'custom-output.deepnote')

    // Run convert with custom output path
    const outputPath = await convert({
      inputPath: notebookPath,
      outputPath: customOutputPath,
      cwd: tempDir,
    })

    expect(outputPath).toBe(customOutputPath)

    // Check that file was created at the custom path
    const exists = await fs
      .access(customOutputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('supports custom outputPath as directory path', async () => {
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputDir = path.join(tempDir, 'output')
    await fs.mkdir(outputDir)

    // Run convert with output directory
    const outputPath = await convert({
      inputPath: notebookPath,
      outputPath: outputDir,
      cwd: tempDir,
    })

    // Check that file was created in the directory
    const expectedPath = path.join(outputDir, 'test.deepnote')
    expect(outputPath).toBe(expectedPath)

    const exists = await fs
      .access(expectedPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('throws error when no .ipynb files found in directory', async () => {
    const emptyDir = path.join(tempDir, 'empty')
    await fs.mkdir(emptyDir)

    // Should throw error
    await expect(
      convert({
        inputPath: emptyDir,
        cwd: tempDir,
      })
    ).rejects.toThrow('No .ipynb files found')
  })

  it('throws error for unsupported file types', async () => {
    const txtPath = path.join(tempDir, 'test.txt')
    await fs.writeFile(txtPath, 'not a notebook', 'utf-8')

    // Should throw error
    await expect(
      convert({
        inputPath: txtPath,
        cwd: tempDir,
      })
    ).rejects.toThrow('Unsupported file type')
  })

  it('converts .deepnote files to Jupyter notebooks', async () => {
    const deepnotePath = path.join(tempDir, 'test.deepnote')
    const deepnoteContent = `metadata:
  createdAt: 2025-11-24T00:00:00.000Z
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: test-notebook-id
      name: Test Notebook
      executionMode: block
      isModule: false
      blocks:
        - id: test-block-id
          blockGroup: test-block-group
          type: code
          content: |
            print("Hello World")
          sortingKey: "1"
          version: 1
          metadata: {}
version: "1.0.0"`

    await fs.writeFile(deepnotePath, deepnoteContent, 'utf-8')

    const outputDir = await convert({
      inputPath: deepnotePath,
      cwd: tempDir,
    })

    const projectName = 'test'
    const expectedOutputDir = path.join(tempDir, projectName)

    expect(outputDir).toBe(expectedOutputDir)

    const stat = await fs.stat(outputDir)

    expect(stat.isDirectory()).toBe(true)

    const files = await fs.readdir(outputDir)

    expect(files).toEqual(['Test-Notebook.ipynb'])
  })

  it('throws error for non-existent paths', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.ipynb')

    // Should throw error
    await expect(
      convert({
        inputPath: nonExistentPath,
        cwd: tempDir,
      })
    ).rejects.toThrow()
  })

  it('throws error when .deepnote file conversion fails', async () => {
    const deepnotePath = path.join(tempDir, 'invalid.deepnote')
    // Write content that will pass file reading but fail YAML parsing/validation
    await fs.writeFile(deepnotePath, 'invalid: [yaml content', 'utf-8')

    await expect(
      convert({
        inputPath: deepnotePath,
        cwd: tempDir,
      })
    ).rejects.toThrow()
  })

  it('resolves relative inputPath against cwd for file', async () => {
    // Create a test notebook
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Use relative path and set cwd
    const outputPath = await convert({
      inputPath: 'test.ipynb',
      cwd: tempDir,
    })

    // Verify the output file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify content
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('test')
  })

  it('resolves relative inputPath against cwd for directory', async () => {
    // Create test notebooks in a subdirectory
    const notebooksDir = path.join(tempDir, 'notebooks')
    await fs.mkdir(notebooksDir)

    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(path.join(notebooksDir, 'test.ipynb'), JSON.stringify(notebook), 'utf-8')

    // Use relative path and set cwd
    const outputPath = await convert({
      inputPath: 'notebooks',
      cwd: tempDir,
    })

    // Verify the output file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify content
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('notebooks')
  })

  it('resolves relative outputPath against cwd', async () => {
    // Create a test notebook
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Create output directory
    const outputDir = path.join(tempDir, 'output')
    await fs.mkdir(outputDir)

    // Use relative outputPath and set cwd
    const outputPath = await convert({
      inputPath: notebookPath,
      outputPath: 'output',
      cwd: tempDir,
    })

    // Verify the output path is resolved correctly
    const expectedPath = path.join(outputDir, 'test.deepnote')
    expect(outputPath).toBe(expectedPath)

    // Verify file exists
    const exists = await fs
      .access(expectedPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('resolves relative outputPath as file against cwd', async () => {
    // Create a test notebook
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Use relative outputPath (file) and set cwd
    const outputPath = await convert({
      inputPath: notebookPath,
      outputPath: 'custom.deepnote',
      cwd: tempDir,
    })

    // Verify the output path is resolved correctly
    const expectedPath = path.join(tempDir, 'custom.deepnote')
    expect(outputPath).toBe(expectedPath)

    // Verify file exists
    const exists = await fs
      .access(expectedPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('correctly handles filenames with multiple dots', async () => {
    // Create a notebook with multiple dots in the filename
    const notebookPath = path.join(tempDir, 'my.test.notebook.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: '# Test Notebook with Dots',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Run convert
    const outputPath = await convert({
      inputPath: notebookPath,
      cwd: tempDir,
    })

    // The output should be correctly named without the .ipynb extension
    const expectedPath = path.join(tempDir, 'my.test.notebook.deepnote')
    expect(outputPath).toBe(expectedPath)

    // Check that the output file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify the project name is correct (should be 'my.test.notebook', not just 'ipynb')
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('my.test.notebook')
  })

  it('correctly handles .deepnote extension with multiple dots in filename', async () => {
    const deepnotePath = path.join(tempDir, 'my.test.file.deepnote')
    const deepnoteContent = `metadata:
  createdAt: 2025-11-24T00:00:00.000Z
project:
  id: test-project-id
  name: Test Project
  notebooks:
    - id: test-notebook-id
      name: Test Notebook
      executionMode: block
      isModule: false
      blocks:
        - id: test-block-id
          blockGroup: test-block-group
          type: code
          content: |
            print("Test")
          sortingKey: "1"
          version: 1
          metadata: {}
version: "1.0.0"`

    await fs.writeFile(deepnotePath, deepnoteContent, 'utf-8')

    // Should convert to Jupyter notebooks even with multiple dots
    const outputDir = await convert({
      inputPath: deepnotePath,
      cwd: tempDir,
    })

    // Should derive output directory from input filename (my.test.file.deepnote -> my.test.file/)
    const expectedOutputDir = path.join(tempDir, 'my.test.file')
    expect(outputDir).toBe(expectedOutputDir)
    expect(path.basename(outputDir)).toBe('my.test.file')

    const stat = await fs.stat(outputDir)
    expect(stat.isDirectory()).toBe(true)

    const files = await fs.readdir(outputDir)
    expect(files.some(file => file.endsWith('.ipynb'))).toBe(true)
  })

  it('correctly rejects unsupported files with multiple dots', async () => {
    const txtPath = path.join(tempDir, 'my.test.file.txt')
    await fs.writeFile(txtPath, 'not a notebook', 'utf-8')

    // Should throw error for unsupported file types even with multiple dots
    await expect(
      convert({
        inputPath: txtPath,
        cwd: tempDir,
      })
    ).rejects.toThrow('Unsupported file type')
  })

  it('ignores directories that end with .ipynb when converting a directory', async () => {
    // Create a directory with notebooks
    const notebooksDir = path.join(tempDir, 'notebooks')
    await fs.mkdir(notebooksDir)

    // Create a valid notebook file
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Valid Notebook' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    await fs.writeFile(path.join(notebooksDir, 'valid.ipynb'), JSON.stringify(notebook), 'utf-8')

    // Create a directory that ends with .ipynb (should be ignored)
    const ipynbDir = path.join(notebooksDir, 'folder.ipynb')
    await fs.mkdir(ipynbDir)

    // Run convert - should succeed and only process the valid file
    const outputPath = await convert({
      inputPath: notebooksDir,
      cwd: tempDir,
    })

    // Verify the conversion succeeded
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify only one notebook was processed (not the directory)
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.notebooks).toHaveLength(1)
    expect(parsed.project.notebooks[0].name).toBe('valid')
  })

  it('creates parent directories when outputPath has non-existent parent dirs', async () => {
    // Create a test notebook
    const notebookPath = path.join(tempDir, 'test.ipynb')
    const notebook = {
      cells: [{ cell_type: 'markdown', metadata: {}, source: '# Test' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    // Specify an output path with nested non-existent directories
    const outputPath = path.join(tempDir, 'deeply', 'nested', 'output', 'result.deepnote')

    // Run convert - should create the parent directories and succeed
    const resultPath = await convert({
      inputPath: notebookPath,
      outputPath,
      cwd: tempDir,
    })

    expect(resultPath).toBe(outputPath)

    // Verify the file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Verify the content is correct
    const content = await fs.readFile(outputPath, 'utf-8')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.name).toBe('test')
  })
})
