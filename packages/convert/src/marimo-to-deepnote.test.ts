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
    // Verifies decorator arguments (hide_code, disabled) are captured directly from the regex match,
    // so parsing works regardless of how much content precedes the decorator
    const content = `import marimo

app = marimo.App()

# This is a very long comment line that exceeds 100 characters and demonstrates that preceding content length does not affect decorator argument parsing

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

  it('preserves relative indentation in multiline code cells', () => {
    // This test ensures that indentation is correctly normalized:
    // all lines should have their common leading indentation removed,
    // but relative indentation between lines should be preserved
    const content = `import marimo

app = marimo.App()

@app.cell
def _():
    import os
    import sqlalchemy

    _password = os.environ.get("POSTGRES_PASSWORD", "postgres")
    DATABASE_URL = f"postgresql://postgres:{_password}@localhost:5432/squeal"
    engine = sqlalchemy.create_engine(DATABASE_URL)

    print(DATABASE_URL)
    return (engine,)

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    const cellContent = app.cells[0].content

    // All lines should start at column 0 (no leading indentation)
    const lines = cellContent.split('\n')
    for (const line of lines) {
      if (line.trim().length > 0) {
        // Non-empty lines should not have leading indentation from the original function body
        expect(line).not.toMatch(/^ {4}/) // Should not have 4-space indent from function body
        expect(line).toBe(line.trimStart()) // Each non-empty line should start at column 0
      }
    }

    // Verify the content is correct
    expect(cellContent).toContain('import os')
    expect(cellContent).toContain('import sqlalchemy')
    expect(cellContent).toContain('_password = os.environ.get')
  })

  it('preserves relative indentation for nested structures', () => {
    // Test that nested code structures maintain their relative indentation
    // Note: The converter removes all return statements (including those inside nested functions)
    // so we test with a structure that doesn't rely on return statements
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    class MyClass:
        def method(self):
            print("nested")
        def other(self):
            if True:
                print("deeply nested")

    obj = MyClass()
    return obj,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    const cellContent = app.cells[0].content
    const lines = cellContent.split('\n').filter(l => l.trim().length > 0)

    // First line should have no indentation
    expect(lines[0]).toBe('class MyClass:')

    // "def method(self):" should be indented by 4 spaces relative to class
    const methodDefLine = lines.find(l => l.includes('def method'))
    expect(methodDefLine).toBe('    def method(self):')

    // "print(\"nested\")" should be indented by 8 spaces (inside method)
    const printNestedLine = lines.find(l => l.includes('print("nested")'))
    expect(printNestedLine).toBe('        print("nested")')

    // "print(\"deeply nested\")" should be indented by 12 spaces (inside if inside method)
    const printDeeplyNestedLine = lines.find(l => l.includes('print("deeply nested")'))
    expect(printDeeplyNestedLine).toBe('            print("deeply nested")')

    // "obj = MyClass()" should have no indentation (same level as first line)
    const objLine = lines.find(l => l.includes('obj = MyClass'))
    expect(objLine).toBe('obj = MyClass()')
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

  it('parses exports with nested commas in function calls', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    result = func(a, b)
    other = compute(x, y, z)
    return result, other,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should correctly identify 'result' and 'other' as exports,
    // not split on commas inside the function calls
    expect(app.cells[0].exports).toEqual(['result', 'other'])
  })

  it('parses exports with nested brackets and braces', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    data = [1, 2, 3]
    config = {"a": 1, "b": 2}
    return data, config,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells[0].exports).toEqual(['data', 'config'])
  })

  it('parses exports with commas inside string literals', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    message = "hello, world"
    count = 42
    return message, count,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should correctly identify 'message' and 'count' as exports,
    // not split on the comma inside the string literal
    expect(app.cells[0].exports).toEqual(['message', 'count'])
  })

  it('parses exports with various quote types and commas', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    single = 'a, b'
    double = "c, d"
    backtick = \`e, f\`
    return single, double, backtick,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should handle single quotes, double quotes, and backticks
    expect(app.cells[0].exports).toEqual(['single', 'double', 'backtick'])
  })

  it('parses exports with escaped quotes', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    text = "She said, \\"hello, there\\""
    other = 'It\\'s a test'
    return text, other,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should handle escaped quotes correctly
    expect(app.cells[0].exports).toEqual(['text', 'other'])
  })

  it('parses exports with brackets inside strings', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    pattern = "data[0]"
    value = 123
    return pattern, value,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should not treat brackets inside strings as nesting
    expect(app.cells[0].exports).toEqual(['pattern', 'value'])
  })

  it('handles # characters inside string literals in return statements', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    hashtag = "#trending"
    comment = "This has a # in it"
    return hashtag, comment,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    // Should correctly parse exports even with # inside strings
    expect(app.cells[0].exports).toEqual(['hashtag', 'comment'])
    // The cell content should not include the cell-level return statement
    expect(app.cells[0].content).not.toContain('return')
    expect(app.cells[0].content).toContain('hashtag = "#trending"')
  })

  it('preserves return statements inside nested functions', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    def helper(x):
        if x > 0:
            return x * 2
        return 0

    def another():
        return "nested return"

    result = helper(5)
    return result,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].exports).toEqual(['result'])

    // Nested returns should be preserved
    expect(app.cells[0].content).toContain('return x * 2')
    expect(app.cells[0].content).toContain('return 0')
    expect(app.cells[0].content).toContain('return "nested return"')

    // Cell-level return should be stripped
    expect(app.cells[0].content).not.toContain('return result')
  })

  it('preserves return statements inside class methods', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    class Calculator:
        def add(self, a, b):
            return a + b

        def multiply(self, a, b):
            return a * b

    calc = Calculator()
    return calc,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].exports).toEqual(['calc'])

    // Method returns should be preserved
    expect(app.cells[0].content).toContain('return a + b')
    expect(app.cells[0].content).toContain('return a * b')

    // Cell-level return should be stripped
    expect(app.cells[0].content).not.toContain('return calc')
  })

  it('parses SQL cells with mo.sql()', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def _(engine):
    df = mo.sql(
        f"""
        SELECT * FROM film
        """,
        engine=engine
    )
    return (df,)

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('sql')
    expect(app.cells[0].content).toContain('SELECT * FROM film')
    expect(app.cells[0].exports).toEqual(['df'])
    expect(app.cells[0].dependencies).toEqual(['engine'])
  })

  it('parses SQL cells with marimo.sql()', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def _(connection):
    result = marimo.sql(
        """
        SELECT COUNT(*) FROM users
        WHERE active = true
        """,
        engine=connection
    )
    return result,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('sql')
    expect(app.cells[0].content).toContain('SELECT COUNT(*) FROM users')
    expect(app.cells[0].content).toContain('WHERE active = true')
    expect(app.cells[0].exports).toEqual(['result'])
    expect(app.cells[0].dependencies).toEqual(['connection'])
  })

  it('parses SQL cells without f-string prefix', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def _(engine):
    data = mo.sql(
        """SELECT id, name FROM products""",
        engine=engine
    )
    return data,

if __name__ == "__main__":
    app.run()
`
    const app = parseMarimoFormat(content)

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('sql')
    expect(app.cells[0].content).toBe('SELECT id, name FROM products')
    expect(app.cells[0].exports).toEqual(['data'])
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

  it('converts SQL cells to Deepnote SQL blocks', () => {
    const app = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT * FROM users',
          dependencies: ['engine'],
          exports: ['df'],
        },
      ],
    }

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks[0].type).toBe('sql')
    expect(blocks[0].content).toBe('SELECT * FROM users')
    expect(blocks[0].metadata?.marimo_dependencies).toEqual(['engine'])
    expect(blocks[0].metadata?.marimo_exports).toEqual(['df'])
    expect(blocks[0].metadata?.deepnote_variable_name).toBe('df')
  })

  it('converts SQL cells without variable name', () => {
    const app = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT COUNT(*) FROM orders',
        },
      ],
    }

    const blocks = convertMarimoAppToBlocks(app)

    expect(blocks[0].type).toBe('sql')
    expect(blocks[0].content).toBe('SELECT COUNT(*) FROM orders')
    expect(blocks[0].metadata?.deepnote_variable_name).toBeUndefined()
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
