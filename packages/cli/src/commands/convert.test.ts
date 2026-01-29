import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'

const SIMPLE_DEEPNOTE_FIXTURE = join('test-fixtures', 'simple.deepnote')

// Mock openDeepnoteInCloud for --open flag tests
const mockOpenDeepnoteInCloud = vi.fn()
vi.mock('../utils/open-in-cloud', () => ({
  openDeepnoteInCloud: (...args: unknown[]) => mockOpenDeepnoteInCloud(...args),
}))

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

describe('convert command', () => {
  let program: Command
  let consoleErrorSpy: Mock<typeof console.error>
  let tempDir: string

  beforeEach(async () => {
    program = new Command()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
    // Suppress spinners in tests
    setOutputConfig({ quiet: true })
    tempDir = await createTempDir()
  })

  afterEach(async () => {
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
      await action(percentPath, { output: outputPath })

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
      await action(percentDir, { output: outputPath })

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(2)
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
      await action(marimoPath, { output: outputPath })

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(1)
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
      await action(marimoDir, { output: outputPath })

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(1)
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
      await action(quartoPath, { output: outputPath })

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(1)
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
      await action(quartoDir, { output: outputPath })

      // Verify file was created
      const fileContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(fileContent)
      expect(parsed.project.notebooks).toHaveLength(2)
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
      await action(notebookPath, { output: outputPath })

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
      await action(notebookPath, { output: outputPath, name: 'My Custom Project' })

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
      await action(notebooksDir, { output: outputPath })

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
      await action(deepnotePath, { output: outputDir })

      // Verify output directory was created with .ipynb files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.ipynb'))).toBe(true)
    })

    it('converts Deepnote to Quarto', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'quarto' })

      // Verify output directory was created with .qmd files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.qmd'))).toBe(true)
    })

    it('converts Deepnote to percent format', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'percent' })

      // Verify output directory was created with .py files
      const files = await fs.readdir(outputDir)
      expect(files.some(f => f.endsWith('.py'))).toBe(true)
    })

    it('converts Deepnote to Marimo', async () => {
      const action = createConvertAction(program)

      const deepnotePath = join(tempDir, 'project.deepnote')
      await createTestDeepnoteFile(deepnotePath)

      const outputDir = join(tempDir, 'output')
      await action(deepnotePath, { output: outputDir, format: 'marimo' })

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

      try {
        await expect(action('non-existent-file.ipynb', {})).rejects.toThrow('process.exit called')

        expect(consoleErrorSpy).toHaveBeenCalled()
        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('not found')
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('reports error for unsupported file type', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        const unsupportedPath = join(tempDir, 'file.txt')
        await fs.writeFile(unsupportedPath, 'content', 'utf-8')

        await expect(action(unsupportedPath, {})).rejects.toThrow('process.exit called')

        expect(consoleErrorSpy).toHaveBeenCalled()
        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('Unsupported')
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('reports error for empty directory', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        const emptyDir = join(tempDir, 'empty')
        await fs.mkdir(emptyDir)

        await expect(action(emptyDir, {})).rejects.toThrow('process.exit called')

        expect(consoleErrorSpy).toHaveBeenCalled()
        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('No supported notebook files')
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('reports error for unsupported Python file (not percent or marimo)', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        // Create a regular Python script that's not percent or marimo format
        const pyPath = join(tempDir, 'script.py')
        await fs.writeFile(pyPath, 'def hello():\n    print("hi")\n', 'utf-8')

        await expect(action(pyPath, {})).rejects.toThrow('process.exit called')

        expect(consoleErrorSpy).toHaveBeenCalled()
        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('Unsupported Python file format')
      } finally {
        exitSpy.mockRestore()
      }
    })
  })

  describe('special characters in filenames', () => {
    it('handles Unicode characters in notebook name', async () => {
      const action = createConvertAction(program)

      const notebookPath = join(tempDir, '日本語ノート.ipynb')
      const notebook = {
        cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'x = 1' }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }
      await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebookPath, { output: outputPath })

      // Verify file was created
      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.notebooks).toHaveLength(1)
    })

    it('handles spaces in notebook name', async () => {
      const action = createConvertAction(program)

      const notebookPath = join(tempDir, 'my notebook with spaces.ipynb')
      const notebook = {
        cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'x = 1' }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }
      await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebookPath, { output: outputPath })

      // Verify file was created
      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.notebooks).toHaveLength(1)
    })

    it('handles emoji in project name', async () => {
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
      await action(notebookPath, { output: outputPath, name: '🚀 My Project 📊' })

      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.name).toBe('🚀 My Project 📊')
    })

    it('handles special characters in directory with mixed-case filenames', async () => {
      const action = createConvertAction(program)

      const notebooksDir = join(tempDir, "notebooks with 'quotes'")
      await fs.mkdir(notebooksDir)

      // Create files with different cases to test case-sensitivity fix
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

      // Use mixed case filenames
      await fs.writeFile(join(notebooksDir, 'MyNotebook.ipynb'), JSON.stringify(notebook1), 'utf-8')
      await fs.writeFile(join(notebooksDir, 'AnotherNOTEBOOK.IPYNB'), JSON.stringify(notebook2), 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(notebooksDir, { output: outputPath })

      const content = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.notebooks).toHaveLength(2)
    })

    it('handles mixed-case Python filenames on case-sensitive filesystems', async () => {
      const action = createConvertAction(program)

      const pyDir = join(tempDir, 'python-notebooks')
      await fs.mkdir(pyDir)

      // Create percent format files with mixed case
      const content = `# %%
x = 1
`
      await fs.writeFile(join(pyDir, 'MyNotebook.py'), content, 'utf-8')
      await fs.writeFile(join(pyDir, 'AnotherNOTEBOOK.PY'), content, 'utf-8')

      const outputPath = join(tempDir, 'output.deepnote')
      await action(pyDir, { output: outputPath })

      // Verify file was created
      const outputContent = await fs.readFile(outputPath, 'utf-8')
      const parsed = deserializeDeepnoteFile(outputContent)
      expect(parsed.project.notebooks).toHaveLength(2)
    })
  })

  describe('--open flag', () => {
    beforeEach(() => {
      mockOpenDeepnoteInCloud.mockReset()
      mockOpenDeepnoteInCloud.mockResolvedValue({
        url: 'https://deepnote.com/launch?importId=test-id',
        importId: 'test-id',
      })
    })

    it('calls openDeepnoteInCloud when converting to .deepnote format with --open', async () => {
      const action = createConvertAction(program)
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        // Create a .ipynb file to convert to .deepnote
        const ipynbPath = join(tempDir, 'notebook.ipynb')
        const ipynbContent = JSON.stringify({
          cells: [{ cell_type: 'code', source: ["print('hello')"], metadata: {}, outputs: [], execution_count: null }],
          metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
          nbformat: 4,
          nbformat_minor: 5,
        })
        await fs.writeFile(ipynbPath, ipynbContent, 'utf-8')

        const outputPath = join(tempDir, 'output.deepnote')
        await action(ipynbPath, { output: outputPath, open: true })

        // Verify openDeepnoteInCloud was called with the output path
        expect(mockOpenDeepnoteInCloud).toHaveBeenCalledTimes(1)
        expect(mockOpenDeepnoteInCloud).toHaveBeenCalledWith(outputPath, expect.any(Object))

        // Verify no warning was shown
        const logOutput = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(logOutput).not.toContain('--open is only available')
      } finally {
        consoleLogSpy.mockRestore()
      }
    })

    it('warns when --open is used with non-deepnote output format', async () => {
      const action = createConvertAction(program)
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const outputDir = join(tempDir, 'output')
        await action(SIMPLE_DEEPNOTE_FIXTURE, { output: outputDir, format: 'jupyter', open: true })

        // Verify warning was shown
        expect(consoleLogSpy).toHaveBeenCalled()
        const logOutput = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(logOutput).toContain('--open is only available when converting to .deepnote format')
      } finally {
        consoleLogSpy.mockRestore()
      }
    })
  })

  describe('format validation', () => {
    it('rejects invalid output format', async () => {
      const action = createConvertAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      try {
        // @ts-expect-error - Testing runtime validation with invalid format
        await expect(action(SIMPLE_DEEPNOTE_FIXTURE, { format: 'invalid-format' })).rejects.toThrow(
          'process.exit called'
        )

        expect(consoleErrorSpy).toHaveBeenCalled()
        const errorOutput = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(errorOutput).toContain('Invalid output format')
        expect(errorOutput).toContain('invalid-format')
        expect(errorOutput).toContain('jupyter, percent, quarto, marimo')
      } finally {
        exitSpy.mockRestore()
      }
    })
  })
})
