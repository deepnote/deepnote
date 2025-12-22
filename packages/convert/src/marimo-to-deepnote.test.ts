import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import * as uuid from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertMarimoAppToBlocks, convertMarimoFilesToDeepnoteFile, parseMarimoFormat } from './marimo-to-deepnote'

// Mock uuid to generate predictable IDs for testing
vi.mock('uuid', async () => {
  const actual = await vi.importActual<typeof import('uuid')>('uuid')
  let counter = 0
  const mockV4 = vi.fn(() => {
    counter++
    return `test-uuid-${counter.toString().padStart(3, '0')}`
  })
  ;(mockV4 as typeof mockV4 & { __resetCounter: () => void }).__resetCounter = () => {
    counter = 0
  }
  return {
    ...actual,
    v4: mockV4,
  }
})

function getMockedUuidV4() {
  return vi.mocked(uuid.v4) as ReturnType<typeof vi.mocked<typeof uuid.v4>> & { __resetCounter: () => void }
}

describe('parseMarimoFormat', () => {
  it('parses version and app settings', () => {
    const content = `import marimo

__generated_with = "0.10.0"
app = marimo.App(width="full", title="My Notebook")

@app.cell
def __():
    print("hello")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.generatedWith).toBe('0.10.0')
    expect(app.width).toBe('full')
    expect(app.title).toBe('My Notebook')
  })

  it('parses a simple code cell', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    print("hello")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('code')
    expect(app.cells[0].content).toBe('print("hello")')
  })

  it('parses cells with dependencies', () => {
    const content = `import marimo

app = marimo.App()

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
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(2)
    expect(app.cells[0].exports).toEqual(['pd'])
    expect(app.cells[1].dependencies).toEqual(['pd'])
    expect(app.cells[1].exports).toEqual(['df'])
  })

  it('parses markdown cells', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    import marimo as mo
    return mo,

@app.cell
def __(mo):
    mo.md(r"""
    # Hello World

    This is markdown.
    """)
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells.length).toBeGreaterThanOrEqual(1)
    const mdCell = app.cells.find(c => c.cellType === 'markdown')
    expect(mdCell).toBeDefined()
    expect(mdCell?.content).toContain('Hello World')
  })

  it('parses markdown cells with all valid string prefixes', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    import marimo as mo
    return mo,

@app.cell
def __(mo):
    mo.md(rf"""Markdown with rf prefix""")
    return

@app.cell
def __(mo):
    mo.md(fr"""Markdown with fr prefix""")
    return

@app.cell
def __(mo):
    mo.md(f"""Markdown with f prefix""")
    return

@app.cell
def __(mo):
    mo.md("""Markdown with no prefix""")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    const mdCells = app.cells.filter(c => c.cellType === 'markdown')
    expect(mdCells.length).toBe(4)
    expect(mdCells[0].content).toContain('rf prefix')
    expect(mdCells[1].content).toContain('fr prefix')
    expect(mdCells[2].content).toContain('f prefix')
    expect(mdCells[3].content).toContain('no prefix')
  })

  it('parses hidden cells', () => {
    const content = `import marimo

app = marimo.App()

@app.cell(hide_code=True)
def __():
    print("hidden")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].hidden).toBe(true)
  })

  it('parses decorator arguments correctly even with long preceding lines', () => {
    // This test verifies that decorator parsing doesn't rely on fixed lookback
    const content = `import marimo

app = marimo.App()

# This is a very long comment line that exceeds 100 characters to ensure the old lookback approach would fail to capture the decorator correctly if it were still being used in the implementation

@app.cell(hide_code=True, disabled=True)
def __():
    print("hidden and disabled")
    return

@app.cell
def __():
    print("normal cell")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(2)
    expect(app.cells[0].hidden).toBe(true)
    expect(app.cells[0].disabled).toBe(true)
    expect(app.cells[1].hidden).toBeUndefined()
    expect(app.cells[1].disabled).toBeUndefined()
  })

  it('parses named functions', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def my_function():
    x = 1
    return x,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].functionName).toBe('my_function')
  })

  it('handles empty content', () => {
    const app = parseMarimoFormat('')

    expect(app.cells).toHaveLength(0)
  })

  it('parses multiline code cells', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    def greet(name):
        """Say hello."""
        return f"Hello, {name}!"

    greet("World")
    return

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].content).toContain('def greet(name):')
    expect(app.cells[0].content).toContain('greet("World")')
  })

  it('parses multiple dependencies', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __(df, np, pd):
    result = df.mean()
    return result,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells[0].dependencies).toEqual(['df', 'np', 'pd'])
  })

  it('parses multiple exports', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    x = 1
    y = 2
    z = 3
    return x, y, z,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells[0].exports).toEqual(['x', 'y', 'z'])
  })
})

describe('convertMarimoAppToBlocks', () => {
  beforeEach(() => {
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
  })

  it('converts a Marimo app to blocks', () => {
    const app = {
      cells: [
        { cellType: 'markdown' as const, content: '# Hello' },
        { cellType: 'code' as const, content: "print('hi')" },
      ],
    }

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[0].content).toBe('# Hello')
    expect(blocks[1].type).toBe('code')
    expect(blocks[1].content).toBe("print('hi')")
  })

  it('uses custom idGenerator when provided', () => {
    let counter = 0
    const customIdGenerator = () => `custom-id-${++counter}`

    const app = {
      cells: [{ cellType: 'code' as const, content: 'x = 1' }],
    }

    const blocks = convertMarimoAppToBlocks(app, {
      idGenerator: customIdGenerator,
    })

    expect(blocks[0].blockGroup).toBe('custom-id-1')
    expect(blocks[0].id).toBe('custom-id-2')
  })

  it('preserves dependencies and exports in metadata', () => {
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

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks[0].metadata).toEqual({
      marimo_dependencies: ['pd'],
      marimo_exports: ['df'],
    })
  })

  it('preserves hidden flag in metadata', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'x = 1',
          hidden: true,
        },
      ],
    }

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks[0].metadata?.is_code_hidden).toBe(true)
  })

  it('preserves named function in metadata', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'x = 1',
          functionName: 'my_function',
        },
      ],
    }

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks[0].metadata?.marimo_function_name).toBe('my_function')
  })
})

describe('convertMarimoFilesToDeepnoteFile', () => {
  let tempDir: string
  const testFixturesDir = path.join(__dirname, '../test-fixtures')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('converts a Marimo file to Deepnote', async () => {
    const inputPath = path.join(testFixturesDir, 'simple.marimo.py')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertMarimoFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.version).toBe('1.0.0')
    expect(result.project.name).toBe('Simple Test')
    expect(result.project.notebooks).toHaveLength(1)

    const notebook = result.project.notebooks[0]
    expect(notebook.blocks.length).toBeGreaterThan(0)
  })

  it('converts the data analysis example', async () => {
    const inputPath = path.join(testFixturesDir, 'data-analysis.marimo.py')
    const outputPath = path.join(tempDir, 'data-analysis.deepnote')

    await convertMarimoFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Data Analysis',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(1)
    const notebook = result.project.notebooks[0]

    // Check we have the right number of cells
    expect(notebook.blocks.length).toBeGreaterThan(5)

    // Check dependencies are preserved
    const blocksWithDeps = notebook.blocks.filter(b => b.metadata?.marimo_dependencies)
    expect(blocksWithDeps.length).toBeGreaterThan(0)
  })

  it('converts multiple Marimo files into one Deepnote file', async () => {
    const inputPaths = [
      path.join(testFixturesDir, 'simple.marimo.py'),
      path.join(testFixturesDir, 'data-analysis.marimo.py'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertMarimoFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks).toHaveLength(2)
  })

  it('uses app title for notebook name when available', async () => {
    const inputPath = path.join(testFixturesDir, 'data-analysis.marimo.py')
    const outputPath = path.join(tempDir, 'data-analysis.deepnote')

    await convertMarimoFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    expect(result.project.notebooks[0].name).toBe('Data Analysis Example')
  })
})
