import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createConvertAction } from './convert'

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(join(os.tmpdir(), 'deepnote-convert-test-'))
}

async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('convert command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let tempDir: string

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
    // Suppress spinners in tests
    setOutputConfig({ quiet: true })
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    await cleanupTempDir(tempDir)
  })

  describe('createConvertAction', () => {
    it('returns a function', () => {
      const action = createConvertAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('converting Jupyter to Deepnote', () => {
    it('converts a single Jupyter notebook', async () => {
      const action = createConvertAction(program)

      // Create a test notebook
      const notebookPath = join(tempDir, 'test.ipynb')
      const notebook = {
        cells: [
          { cell_type: 'markdown', metadata: {}, source: '# Test' },
          { cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'print("hello")' },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }
      await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebookPath, { output: outputPath, json: true })

      // Verify output
      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.outputFormat).toBe('deepnote')

      // Verify file was created
      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.notebooks).toHaveLength(1)
      expect(parsed.project.notebooks[0].blocks).toHaveLength(2)
    })

    it('converts with custom project name', async () => {
      const action = createConvertAction(program)

      const notebookPath = join(tempDir, 'test.ipynb')
      const notebook = {
        cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'x = 1' }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }
      await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebookPath, { output: outputPath, name: 'My Custom Project', json: true })

      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.name).toBe('My Custom Project')
    })

    it('converts a directory of notebooks', async () => {
      const action = createConvertAction(program)

      // Create test notebooks
      const notebooksDir = join(tempDir, 'notebooks')
      await fs.mkdir(notebooksDir)

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

      await fs.writeFile(join(notebooksDir, 'nb1.ipynb'), JSON.stringify(notebook1), 'utf-8')
      await fs.writeFile(join(notebooksDir, 'nb2.ipynb'), JSON.stringify(notebook2), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebooksDir, { output: outputPath, json: true })

      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.notebooks).toHaveLength(2)
    })
  })

  describe('converting Deepnote to other formats', () => {
    const createTestDeepnoteFile = async (filePath: string): Promise<void> => {
      const content = `metadata:
  createdAt: "2025-01-01T00:00:00Z"
project:
  id: test-id
  name: Test Project
  notebooks:
    - id: notebook-1
      name: Test Notebook
      blocks:
        - id: block-1
          type: code
          content: "print('hello')"
          blockGroup: group-1
          sortingKey: a0
          metadata: {}
version: "1.0.0"
`
      await fs.writeFile(filePath, content, 'utf-8')
    }

    it('converts Deepnote to Jupyter (default)', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.outputFormat).toBe('jupyter')

      // Verify output directory was created with .ipynb files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.ipynb'))).toBe(true)
    })

    it('converts Deepnote to Quarto', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'quarto', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.outputFormat).toBe('quarto')

      // Verify output directory was created with .qmd files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.qmd'))).toBe(true)
    })

    it('converts Deepnote to percent format', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'percent', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.outputFormat).toBe('percent')

      // Verify output directory was created with .py files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.py'))).toBe(true)
    })

    it('converts Deepnote to Marimo', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'marimo', json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.outputFormat).toBe('marimo')

      // Verify output directory was created with .py files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.py'))).toBe(true)
    })
  })

  describe('error handling', () => {
    it('reports error when file not found', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.ipynb', { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')

      exitSpy.mockRestore()
    })

    it('reports error for unsupported file type', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      const unsupportedPath = join(tempDir, 'file.txt')
      await fs.writeFile(unsupportedPath, 'content', 'utf-8')

      await expect(action(unsupportedPath, { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsupported')

      exitSpy.mockRestore()
    })

    it('reports error for empty directory', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      const emptyDir = join(tempDir, 'empty')
      await fs.mkdir(emptyDir)

      await expect(action(emptyDir, { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('No supported notebook files')

      exitSpy.mockRestore()
    })
  })

  describe('JSON output structure', () => {
    it('includes all required fields on success', async () => {
      const action = createConvertAction(program)

      const notebookPath = join(tempDir, 'test.ipynb')
      const notebook = {
        cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'x = 1' }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }
      await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebookPath, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('inputPath')
      expect(result).toHaveProperty('outputPath')
      expect(result).toHaveProperty('inputFormat')
      expect(result).toHaveProperty('outputFormat')
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('jupyter')
      expect(result.outputFormat).toBe('deepnote')
    })

    it('includes error field on failure', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent.ipynb', { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('error')
      expect(result.success).toBe(false)
      expect(typeof result.error).toBe('string')

      exitSpy.mockRestore()
    })
  })
})
