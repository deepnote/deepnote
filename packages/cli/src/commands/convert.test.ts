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

  describe('converting percent format to Deepnote', () => {
    it('converts a single percent format file', async () => {
      const action = createConvertAction(program)

      const percentPath = join(tempDir, 'notebook.py')
      const content = `# %%
# This is a markdown cell

# %%
x = 1
print(x)
`
      await fs.writeFile(percentPath, content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(percentPath, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('percent')
      expect(result.outputFormat).toBe('deepnote')

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(1)
    })

    it('converts a directory of percent format files', async () => {
      const action = createConvertAction(program)

      const percentDir = join(tempDir, 'percent-notebooks')
      await fs.mkdir(percentDir)

      const content1 = `# %%
x = 1
`
      const content2 = `# %%
y = 2
`

      await fs.writeFile(join(percentDir, 'nb1.py'), content1, 'utf-8')
      await fs.writeFile(join(percentDir, 'nb2.py'), content2, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(percentDir, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('percent')
    })
  })

  describe('converting Marimo format to Deepnote', () => {
    it('converts a single Marimo file', async () => {
      const action = createConvertAction(program)

      const marimoPath = join(tempDir, 'notebook.py')
      const content = `import marimo

app = marimo.App()

@app.cell
def __():
    x = 1
    return x,

if __name__ == "__main__":
    app.run()
`
      await fs.writeFile(marimoPath, content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(marimoPath, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('marimo')
      expect(result.outputFormat).toBe('deepnote')
    })

    it('converts a directory of Marimo files', async () => {
      const action = createConvertAction(program)

      const marimoDir = join(tempDir, 'marimo-notebooks')
      await fs.mkdir(marimoDir)

      const content = `import marimo

app = marimo.App()

@app.cell
def __():
    x = 1
    return x,

if __name__ == "__main__":
    app.run()
`
      await fs.writeFile(join(marimoDir, 'nb1.py'), content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(marimoDir, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('marimo')
    })
  })

  describe('converting Quarto to Deepnote', () => {
    it('converts a single Quarto document', async () => {
      const action = createConvertAction(program)

      const quartoPath = join(tempDir, 'notebook.qmd')
      const content = `---
title: Test Notebook
---

## Introduction

This is a test.

\`\`\`{python}
x = 1
print(x)
\`\`\`
`
      await fs.writeFile(quartoPath, content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(quartoPath, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('quarto')
      expect(result.outputFormat).toBe('deepnote')
    })

    it('converts a directory of Quarto documents', async () => {
      const action = createConvertAction(program)

      const quartoDir = join(tempDir, 'quarto-docs')
      await fs.mkdir(quartoDir)

      const content = `---
title: Test
---

\`\`\`{python}
x = 1
\`\`\`
`

      await fs.writeFile(join(quartoDir, 'nb1.qmd'), content, 'utf-8')
      await fs.writeFile(join(quartoDir, 'nb2.qmd'), content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(quartoDir, { output: outputPath, json: true })

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(true)
      expect(result.inputFormat).toBe('quarto')
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

    it('reports error for unsupported Python file (not percent or marimo)', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      // Create a regular Python script that's not percent or marimo format
      const pyPath = join(tempDir, 'script.py')
      await fs.writeFile(pyPath, 'def hello():\n    print("hi")\n', 'utf-8')

      await expect(action(pyPath, { json: true })).rejects.toThrow('process.exit called')

      const output = getOutput(consoleSpy)
      const result = JSON.parse(output)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsupported Python file format')

      exitSpy.mockRestore()
    })

    it('reports error to stderr in non-JSON mode', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action('non-existent-file.ipynb', {})).rejects.toThrow('process.exit called')

      // In non-JSON mode, error should be logged to stderr
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorOutput).toContain('not found')

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
