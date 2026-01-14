import { describe, expect, it } from 'vitest'
import { detectFormat, isMarimoContent, isPercentContent } from './format-detection'

describe('isMarimoContent', () => {
  it('detects valid Marimo content', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    print("hello")
    return
`
    expect(isMarimoContent(content)).toBe(true)
  })

  it('returns false for content without marimo import', () => {
    const content = `@app.cell
def __():
    print("hello")
`
    expect(isMarimoContent(content)).toBe(false)
  })

  it('returns false for content without @app.cell', () => {
    const content = `import marimo

app = marimo.App()
print("hello")
`
    expect(isMarimoContent(content)).toBe(false)
  })

  it('returns false when markers are inside triple-quoted strings', () => {
    const content = `"""
import marimo
@app.cell
"""
print("hello")
`
    expect(isMarimoContent(content)).toBe(false)
  })

  it('returns false for percent format content', () => {
    const content = `# %%
print("hello")
`
    expect(isMarimoContent(content)).toBe(false)
  })
})

describe('isPercentContent', () => {
  it('detects valid percent format content', () => {
    const content = `# %%
print("hello")

# %%
x = 1
`
    expect(isPercentContent(content)).toBe(true)
  })

  it('returns false for content without # %% marker', () => {
    const content = `print("hello")
x = 1
`
    expect(isPercentContent(content)).toBe(false)
  })

  it('returns false when marker is inside triple-quoted strings', () => {
    const content = `"""
# %%
Some docstring
"""
print("hello")
`
    expect(isPercentContent(content)).toBe(false)
  })

  it('returns false for Marimo content', () => {
    const content = `import marimo

app = marimo.App()

@app.cell
def __():
    print("hello")
`
    expect(isPercentContent(content)).toBe(false)
  })
})

describe('detectFormat', () => {
  describe('file extension detection', () => {
    it('detects Jupyter notebooks by .ipynb extension', () => {
      expect(detectFormat('notebook.ipynb')).toBe('jupyter')
      expect(detectFormat('path/to/notebook.IPYNB')).toBe('jupyter')
    })

    it('detects Deepnote files by .deepnote extension', () => {
      expect(detectFormat('project.deepnote')).toBe('deepnote')
      expect(detectFormat('path/to/project.DEEPNOTE')).toBe('deepnote')
    })

    it('detects Quarto documents by .qmd extension', () => {
      expect(detectFormat('document.qmd')).toBe('quarto')
      expect(detectFormat('path/to/document.QMD')).toBe('quarto')
    })
  })

  describe('Python file detection', () => {
    it('detects Marimo format from .py file with content', () => {
      const content = `import marimo

app = marimo.App()

@app.cell
def __():
    print("hello")
`
      expect(detectFormat('notebook.py', content)).toBe('marimo')
    })

    it('detects percent format from .py file with content', () => {
      const content = `# %%
print("hello")

# %%
x = 1
`
      expect(detectFormat('notebook.py', content)).toBe('percent')
    })

    it('throws error for .py file without content', () => {
      expect(() => detectFormat('notebook.py')).toThrow('Content is required to detect format for .py files')
    })

    it('throws error for unsupported .py file format', () => {
      const content = `print("hello")
x = 1
`
      expect(() => detectFormat('notebook.py', content)).toThrow(
        'Unsupported Python file format. File must be percent format (# %%) or Marimo (@app.cell).'
      )
    })
  })

  describe('unsupported formats', () => {
    it('throws error for unsupported file extensions', () => {
      expect(() => detectFormat('file.txt')).toThrow('Unsupported file format: file.txt')
      expect(() => detectFormat('file.js')).toThrow('Unsupported file format: file.js')
      expect(() => detectFormat('file.json')).toThrow('Unsupported file format: file.json')
    })
  })
})
