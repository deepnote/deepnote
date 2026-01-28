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
    expect(result).toContain('app = marimo.App(')
    expect(result).toContain('__generated_with = "0.10.0"')
    expect(result).toContain('width="full"')
    expect(result).toContain('title="My Notebook"')
  })

  it('serializes a simple code cell', () => {
    const app = {
      cells: [{ cellType: 'code' as const, content: 'print("hello")' }],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo')
    expect(result).toContain('app = marimo.App()')
    expect(result).toContain('@app.cell')
    expect(result).toContain('def __():')
    expect(result).toContain('print("hello")')
  })

  it('serializes a markdown cell', () => {
    const app = {
      cells: [{ cellType: 'markdown' as const, content: '# Hello World\n\nThis is a test.' }],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo as mo')
    expect(result).toContain('app = mo.App()')
    expect(result).toContain('@app.cell')
    expect(result).toContain('mo.md(r"""')
    expect(result).toContain('# Hello World')
    expect(result).toContain('This is a test.')
  })

  it('serializes a SQL cell', () => {
    const app = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT * FROM users WHERE active = true',
          dependencies: ['engine'],
          exports: ['df'],
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo as mo')
    expect(result).toContain('app = mo.App()')
    expect(result).toContain('@app.cell')
    expect(result).toContain('def __(engine):')
    expect(result).toContain('df = mo.sql(')
    expect(result).toContain('f"""')
    expect(result).toContain('SELECT * FROM users WHERE active = true')
    expect(result).toContain('engine=engine')
    expect(result).toContain('return df,')
  })

  it('serializes a SQL cell without engine dependency', () => {
    const app = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT COUNT(*) FROM orders',
          exports: ['count'],
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('count = mo.sql(')
    expect(result).toContain('SELECT COUNT(*) FROM orders')
    expect(result).not.toContain('engine=')
    expect(result).toContain('return count,')
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

  it('does not indent empty lines in code cells', () => {
    const app = {
      cells: [
        {
          cellType: 'code' as const,
          content: 'x = 1\n\ny = 2\n\n\nz = 3',
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    // Empty lines should not have indentation (no trailing spaces)
    const lines = result.split('\n')
    const emptyLines = lines.filter(line => line === '')
    expect(emptyLines.length).toBeGreaterThan(0) // Should have empty lines

    // Verify no lines are just whitespace (4 spaces)
    const whitespaceOnlyLines = lines.filter(line => line === '    ')
    expect(whitespaceOnlyLines.length).toBe(0)

    // Non-empty code lines should still be indented
    expect(result).toContain('    x = 1')
    expect(result).toContain('    y = 2')
    expect(result).toContain('    z = 3')
  })

  it('does not indent empty lines in markdown cells', () => {
    const app = {
      cells: [
        {
          cellType: 'markdown' as const,
          content: '# Title\n\nParagraph 1\n\n\nParagraph 2',
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    // Find the markdown content section (between mo.md(r""" and """))
    const lines = result.split('\n')
    const mdStartIdx = lines.findIndex(line => line.includes('mo.md(r"""'))
    const mdEndIdx = lines.findIndex((line, idx) => idx > mdStartIdx && line.includes('"""'))

    // Check lines within the markdown block
    const mdLines = lines.slice(mdStartIdx + 1, mdEndIdx)

    // Empty lines should be truly empty (no spaces)
    const emptyLines = mdLines.filter(line => line === '')
    expect(emptyLines.length).toBeGreaterThan(0) // Should have empty lines

    // Verify no lines are just whitespace (4 spaces)
    const whitespaceOnlyLines = mdLines.filter(line => line === '    ')
    expect(whitespaceOnlyLines.length).toBe(0)

    // Non-empty markdown lines should still be indented
    expect(result).toContain('    # Title')
    expect(result).toContain('    Paragraph 1')
    expect(result).toContain('    Paragraph 2')
  })

  it('does not indent empty lines in SQL cells', () => {
    const app = {
      cells: [
        {
          cellType: 'sql' as const,
          content: 'SELECT *\nFROM users\n\nWHERE active = true\n\n\nORDER BY name',
          dependencies: ['engine'],
          exports: ['df'],
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    // Find the SQL content section (between f""" and """)
    const lines = result.split('\n')
    const sqlStartIdx = lines.findIndex(line => line.includes('f"""'))
    const sqlEndIdx = lines.findIndex((line, idx) => idx > sqlStartIdx && line.includes('"""'))

    // Check lines within the SQL block
    const sqlLines = lines.slice(sqlStartIdx + 1, sqlEndIdx)

    // Empty lines should be truly empty (no spaces)
    const emptyLines = sqlLines.filter(line => line === '')
    expect(emptyLines.length).toBeGreaterThan(0) // Should have empty lines

    // Verify no lines are just whitespace (4 spaces or 8 spaces)
    const whitespaceOnlyLines = sqlLines.filter(line => /^\s+$/.test(line))
    expect(whitespaceOnlyLines.length).toBe(0)

    // Non-empty SQL lines should still be indented
    expect(result).toContain('        SELECT *')
    expect(result).toContain('        FROM users')
    expect(result).toContain('        WHERE active = true')
    expect(result).toContain('        ORDER BY name')
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
        metadata: {},
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
        metadata: {},
      },
    ]

    const app = convertBlocksToMarimoApp(blocks, 'Test')

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('code')
    expect(app.cells[0].content).toBe('print("hello")')
  })

  it('converts SQL blocks', () => {
    const blocks: DeepnoteBlock[] = [
      {
        id: 'block-1',
        type: 'sql',
        content: 'SELECT * FROM users',
        blockGroup: 'group-1',
        sortingKey: '0',
        metadata: {
          deepnote_variable_name: 'df',
          marimo_dependencies: ['engine'],
          marimo_exports: ['df'],
        },
      },
    ]

    const app = convertBlocksToMarimoApp(blocks, 'Test')

    expect(app.cells).toHaveLength(1)
    expect(app.cells[0].cellType).toBe('sql')
    expect(app.cells[0].content).toBe('SELECT * FROM users')
    expect(app.cells[0].dependencies).toEqual(['engine'])
    expect(app.cells[0].exports).toEqual(['df'])
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
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

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
  const testFixturesDir = path.join(__dirname, '../../../test-fixtures')

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

      // Verify it's parsable
      const app = parseMarimoFormat(content)
      expect(app.cells.length).toBeGreaterThan(0)
    }
  })
})

describe('convertDeepnoteFileToMarimoFiles error handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rejects with a clear error when the .deepnote file does not exist', async () => {
    const nonExistentPath = path.join(__dirname, '../test-fixtures/does-not-exist.deepnote')
    const outputDir = path.join(tempDir, 'output')

    await expect(convertDeepnoteFileToMarimoFiles(nonExistentPath, { outputDir })).rejects.toThrow(
      /ENOENT|no such file/
    )
  })

  it('rejects with an error when the file contains invalid YAML', async () => {
    const invalidYamlPath = path.join(tempDir, 'invalid.deepnote')
    await fs.writeFile(invalidYamlPath, 'invalid: [yaml: {missing closing bracket', 'utf-8')

    const outputDir = path.join(tempDir, 'output')

    await expect(convertDeepnoteFileToMarimoFiles(invalidYamlPath, { outputDir })).rejects.toThrow()
  })

  it('provides clear error message with filename when file write fails', async () => {
    const testFixturesDir = path.join(__dirname, '../../../test-fixtures')
    const inputPath = path.join(testFixturesDir, 'simple.deepnote')

    // Use a read-only directory to trigger write failure
    const readOnlyDir = path.join(tempDir, 'readonly')
    await fs.mkdir(readOnlyDir, { mode: 0o444 })

    try {
      await convertDeepnoteFileToMarimoFiles(inputPath, { outputDir: readOnlyDir })
      // If it doesn't throw, fail the test
      expect.fail('Expected function to throw an error')
    } catch (err) {
      // Verify the error message includes the filename
      expect(err).toBeInstanceOf(Error)
      const error = err as Error
      expect(error.message).toMatch(/Failed to write.*\.py/)
      // Verify it includes context about the original error
      expect(error.cause).toBeDefined()
    } finally {
      // Clean up: make directory writable again so afterEach can remove it
      await fs.chmod(readOnlyDir, 0o755).catch(() => {})
    }
  })
})

describe('Marimo import handling', () => {
  it('uses "import marimo as mo" when there are markdown cells', () => {
    const app = {
      cells: [
        { cellType: 'code' as const, content: 'x = 1' },
        { cellType: 'markdown' as const, content: '# Title' },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo as mo')
    expect(result).toContain('app = mo.App()')
    expect(result).toContain('mo.md(r"""')
  })

  it('uses "import marimo" when there are only code cells', () => {
    const app = {
      cells: [
        { cellType: 'code' as const, content: 'x = 1' },
        { cellType: 'code' as const, content: 'y = 2' },
      ],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('import marimo')
    expect(result).not.toContain('import marimo as mo')
    expect(result).toContain('app = marimo.App()')
  })
})

describe('String escaping', () => {
  it('escapes control characters in title strings', () => {
    const app = {
      title: 'Title with\nnewline and\ttab',
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('title="Title with\\nnewline and\\ttab"')
  })

  it('escapes backslashes and quotes in title strings', () => {
    const app = {
      title: 'Title with "quotes" and \\backslash',
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('title="Title with \\"quotes\\" and \\\\backslash"')
  })

  it('escapes non-printable characters in title strings', () => {
    const app = {
      title: 'Title with\x00null\x1Fcontrol',
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('\\u0000')
    expect(result).toContain('\\u001f')
  })

  it('escapes triple quotes in markdown cells', () => {
    const app = {
      cells: [{ cellType: 'markdown' as const, content: 'Text with """ triple quotes' }],
    }

    const result = serializeMarimoFormat(app)

    expect(result).toContain('mo.md(r"""')
    // Triple quotes are escaped by breaking the raw string and concatenating
    expect(result).toContain('Text with """+\'"\'+r""" triple quotes')
    expect(result).toContain('""")')
  })

  it('handles markdown with multiple triple quote sequences', () => {
    const app = {
      cells: [{ cellType: 'markdown' as const, content: '""" first """ and """ second """' }],
    }

    const result = serializeMarimoFormat(app)

    // Each """ should be escaped by breaking the raw string
    // The pattern """+'"'+r""" should appear for each embedded triple quote
    const escapePattern = /"""\+'"'\+r"""/g
    const escapeCount = (result.match(escapePattern) || []).length
    expect(escapeCount).toBe(4) // 4 embedded triple quotes in the content
  })

  it('generates valid Python code with embedded triple quotes', () => {
    const app = {
      cells: [
        {
          cellType: 'markdown' as const,
          content: 'Example: ```python\ncode = """\nMultiline\n"""\n```',
        },
      ],
    }

    const result = serializeMarimoFormat(app)

    // Verify the structure: r"""..."""+'"'+r"""..."""
    expect(result).toContain('mo.md(r"""')
    expect(result).toContain('"""+\'"\'+r"""')
    // The closing should still be """
    expect(result).toMatch(/"""[)\s]*return/)
  })

  it('preserves newlines in markdown cells with raw strings', () => {
    const app = {
      cells: [{ cellType: 'markdown' as const, content: 'Line 1\nLine 2\nLine 3' }],
    }

    const result = serializeMarimoFormat(app)

    // Raw strings preserve literal newlines
    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
    expect(result).toContain('Line 3')
  })

  it('handles all control characters in title', () => {
    const app = {
      title: 'Test\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F',
      cells: [],
    }

    const result = serializeMarimoFormat(app)

    // Should escape all control characters
    expect(result).toContain('\\u0000') // null
    expect(result).toContain('\\u0001') // start of heading
    expect(result).toContain('\\t') // tab (0x09)
    expect(result).toContain('\\n') // newline (0x0A)
    expect(result).toContain('\\r') // carriage return (0x0D)
    expect(result).toContain('\\b') // backspace (0x08)
    expect(result).toContain('\\f') // form feed (0x0C)
  })

  it('generates valid Python code with special characters', () => {
    const app = {
      title: 'Test "quotes" and \\backslash\nand newline',
      cells: [
        { cellType: 'code' as const, content: 'x = 1' },
        { cellType: 'markdown' as const, content: 'Markdown with """ triple quotes' },
      ],
    }

    const result = serializeMarimoFormat(app)

    // The generated code should be syntactically valid Python
    expect(result).toContain('import marimo as mo')
    expect(result).toContain('title="Test \\"quotes\\" and \\\\backslash\\nand newline"')
    expect(result).toContain('mo.md(r"""')
    expect(result).toContain('Markdown with """+\'"\'+r"""')
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
    const testFixturesDir = path.join(__dirname, '../../../test-fixtures')
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
