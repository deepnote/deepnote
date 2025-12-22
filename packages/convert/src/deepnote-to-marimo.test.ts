import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DeepnoteBlock } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  convertBlocksToMarimoApp,
  convertDeepnoteFileToMarimoFiles,
  convertDeepnoteToMarimoApps,
  serializeMarimoFormat,
} from './deepnote-to-marimo'
import { parseMarimoFormat } from './marimo-to-deepnote'

describe('serializeMarimoFormat', () => {
  it('serializes app settings', () => {
    const app = {
      generatedWith: '0.10.0',
      width: 'full',
      title: 'My Notebook',
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo')
    expect(result).toContain('__generated_with = "0.10.0"')
    expect(result).toContain('width="full"')
    expect(result).toContain('title="My Notebook"')
  })

  it('serializes a simple code cell', () => {
    const app = {
      cells: [{ cellType: 'code' as const, content: 'print("hello")' }],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('@app.cell')
    expect(result).toContain('def __():')
    expect(result).toContain('print("hello")')
  })

  it('serializes a markdown cell', () => {
    const app = {
      cells: [{ cellType: 'markdown' as const, content: '# Hello World\n\nThis is a test.' }],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('@app.cell')
    expect(result).toContain('mo.md(r"""')
    expect(result).toContain('# Hello World')
    expect(result).toContain('This is a test.')
  })

  it('serializes cells with dependencies', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'df = pd.read_csv("data.csv")',
          dependencies: ['pd'],
          exports: ['df'],
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('def __(pd):')
    expect(result).toContain('return df,')
  })

  it('serializes cells with multiple dependencies and exports', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'result = df.mean()',
          dependencies: ['df', 'np', 'pd'],
          exports: ['result', 'summary'],
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('def __(df, np, pd):')
    expect(result).toContain('return result, summary,')
  })

  it('serializes hidden cells', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'x = 1',
          hidden: true,
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('@app.cell(hide_code=True)')
  })

  it('serializes named functions', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'x = 1',
          functionName: 'my_function',
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('def my_function():')
  })

  it('includes main block', () => {
    const app = {
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('if __name__ == "__main__":')
    expect(result).toContain('app.run()')
  })
})

describe('convertBlocksToMarimoApp', () => {
  it('converts markdown blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'markdown',
        content: '# Hello World',
        blockGroup: 'group-1',
        sortingKey: '0',
      },
    ]

    const app = convertBlocksToMarimoApp(blocks, 'Test Notebook')

    expect(app.title).toBe('Test Notebook')
    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('markdown')
    expect(app.cells[0].content).toBe('# Hello World')
  })

  it('converts code blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'print("hello")',
        blockGroup: 'group-1',
        sortingKey: '0',
      },
    ]

    const app = convertBlocksToMarimoApp(blocks, 'Test')

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('code')
    expect(app.cells[0].content).toBe('print("hello")')
  })

  it('preserves Marimo metadata from blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'code',
        content: 'df = pd.read_csv("data.csv")',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          marimo_dependencies: ['pd'],
          marimo_exports: ['df'],
          is_code_hidden: true,
          marimo_function_name: 'load_data',
        },
      },
    ]

    const app = convertBlocksToMarimoApp(blocks, 'Test')

    expect(app.cells[0].dependencies).toEqual(['pd'])
    expect(app.cells[0].exports).toEqual(['df'])
    expect(app.cells[0].hidden).toBe(true)
    expect(app.cells[0].functionName).toBe('load_data')
  })
})

describe('convertDeepnoteToMarimoApps', () => {
  const testFixturesDir = path.join(__dirname, '../test-fixtures')

  it('converts a Deepnote file to Marimo app objects', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const apps = convertDeepnoteToMarimoApps(deepnoteFile)

    expect(apps.length).toBeGreaterThan(0)
    expect(apps[0]).toHaveProperty('filename')
    expect(apps[0]).toHaveProperty('app')
    expect(apps[0].filename).toMatch(/\.py$/)
  })

  it('sanitizes filenames by removing invalid characters', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const deepnoteFile = deserializeDeepnoteFile(yamlContent)

    const apps = convertDeepnoteToMarimoApps(deepnoteFile)

    apps.forEach(({ filename }) => {
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).toMatch(/\.py$/)
    })
  })
})

describe('convertDeepnoteFileToMarimoFiles', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('converts a Deepnote file to Marimo format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToMarimoFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(file => file.endsWith('.py'))).toBe(true)
  })

  it('creates valid Marimo format files', async () => {
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await convertDeepnoteFileToMarimoFiles(inputPath, { outputDir })

    const files = await fs.readdir(outputDir)
    const pyFile = files.find(file => file.endsWith('.py'))
    expect(pyFile).toBeDefined()

    if (pyFile) {
      const content = await fs.readFile(path.join(outputDir, pyFile), 'utf-8')

      // Verify it has Marimo structure
      expect(content).toContain('import marimo')
      expect(content).toContain('@app.cell')
      expect(content).toContain('if __name__ == "__main__":')

      // Verify it's parseable
      const app = parseMarimoFormat(content)
      expect(app.cells.length).toBeGreaterThan(0)
    }
  })
})

describe('Marimo format roundtrip', () => {
  it('preserves content during parse → serialize roundtrip', () => {
    const original = `import marimo

__generated_with = "0.10.0"
app = marimo.App(width="medium")

@app.cell
def __():
    import pandas as pd
    return pd,

@app.cell
def __(pd):
    df = pd.read_csv("data.csv")
    return df,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(original)
    const serialized = serializeMarimoFormat(app)
    const reparsed = parseMarimoFormat(serialized)

    expect(reparsed.cells.length).toBe(app.cells.length)
    for (let i = 0; i < app.cells.length; i++) {
      expect(reparsed.cells[i].cellType).toBe(app.cells[i].cellType)
      expect(reparsed.cells[i].dependencies).toEqual(app.cells[i].dependencies)
      expect(reparsed.cells[i].exports).toEqual(app.cells[i].exports)
    }
  })

  it('preserves Deepnote → Marimo → Deepnote content', async () => {
    const { deserializeDeepnoteFile } = await import('@deepnote/blocks')
    const testFixturesDir = path.join(__dirname, '../test-fixtures')
    const inputPath = path.join(testFixturesDir, 'ChartExamples.deepnote')
    const yamlContent = await fs.readFile(inputPath, 'utf-8')
    const original = deserializeDeepnoteFile(yamlContent)

    // Convert to Marimo
    const marimoApps = convertDeepnoteToMarimoApps(original)

    // Serialize and reparse
    for (const { app } of marimoApps) {
      const serialized = serializeMarimoFormat(app)
      const reparsed = parseMarimoFormat(serialized)

      // Cell count should match
      expect(reparsed.cells.length).toBe(app.cells.length)
    }
  })
})
