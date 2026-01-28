import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileResolutionError } from './file-resolver'
import { isRunnableExtension, RUNNABLE_EXTENSIONS, resolveAndConvertToDeepnote } from './format-converter'

// Test files relative to project root
const HELLO_WORLD_FILE = join('examples', '1_hello_world.deepnote')

// Test fixtures
const JUPYTER_FIXTURE = join('test-fixtures', 'formats', 'jupyter', 'basic.ipynb')
const PERCENT_FIXTURE = join('test-fixtures', 'formats', 'percent', 'basic-cells.percent.py')
const QUARTO_FIXTURE = join('test-fixtures', 'formats', 'quarto', 'basic.qmd')

describe('format-converter', () => {
  describe('RUNNABLE_EXTENSIONS', () => {
    it('includes .deepnote', () => {
      expect(RUNNABLE_EXTENSIONS).toContain('.deepnote')
    })

    it('includes .ipynb', () => {
      expect(RUNNABLE_EXTENSIONS).toContain('.ipynb')
    })

    it('includes .py', () => {
      expect(RUNNABLE_EXTENSIONS).toContain('.py')
    })

    it('includes .qmd', () => {
      expect(RUNNABLE_EXTENSIONS).toContain('.qmd')
    })
  })

  describe('isRunnableExtension', () => {
    it('returns true for .deepnote', () => {
      expect(isRunnableExtension('.deepnote')).toBe(true)
    })

    it('returns true for .ipynb', () => {
      expect(isRunnableExtension('.ipynb')).toBe(true)
    })

    it('returns true for .py', () => {
      expect(isRunnableExtension('.py')).toBe(true)
    })

    it('returns true for .qmd', () => {
      expect(isRunnableExtension('.qmd')).toBe(true)
    })

    it('returns false for .json', () => {
      expect(isRunnableExtension('.json')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isRunnableExtension('')).toBe(false)
    })

    it('is case-insensitive', () => {
      // The function lowercases the input before checking
      expect(isRunnableExtension('.DEEPNOTE')).toBe(true)
      expect(isRunnableExtension('.DeepNote')).toBe(true)
      expect(isRunnableExtension('.IPYNB')).toBe(true)
      expect(isRunnableExtension('.deepnote')).toBe(true)
    })
  })

  describe('resolveAndConvertToDeepnote', () => {
    describe('with native .deepnote files', () => {
      it('loads .deepnote files without conversion', async () => {
        const result = await resolveAndConvertToDeepnote(HELLO_WORLD_FILE)

        expect(result.format).toBe('deepnote')
        expect(result.wasConverted).toBe(false)
        expect(result.file).toBeDefined()
        expect(result.file.project).toBeDefined()
        expect(result.originalPath).toContain('1_hello_world.deepnote')
      })

      it('returns file with correct project structure', async () => {
        const result = await resolveAndConvertToDeepnote(HELLO_WORLD_FILE)

        expect(result.file.project.notebooks).toBeDefined()
        expect(Array.isArray(result.file.project.notebooks)).toBe(true)
      })
    })

    describe('with Jupyter notebooks', () => {
      it('converts .ipynb files to DeepnoteFile', async () => {
        const result = await resolveAndConvertToDeepnote(JUPYTER_FIXTURE)

        expect(result.format).toBe('jupyter')
        expect(result.wasConverted).toBe(true)
        expect(result.file).toBeDefined()
        expect(result.file.project).toBeDefined()
        expect(result.originalPath).toContain('.ipynb')
      })
    })

    describe('with percent format files', () => {
      it('converts percent format .py files to DeepnoteFile', async () => {
        const result = await resolveAndConvertToDeepnote(PERCENT_FIXTURE)

        expect(result.format).toBe('percent')
        expect(result.wasConverted).toBe(true)
        expect(result.file).toBeDefined()
        expect(result.file.project).toBeDefined()
        expect(result.originalPath).toContain('.py')
      })
    })

    describe('with Quarto documents', () => {
      it('converts .qmd files to DeepnoteFile', async () => {
        const result = await resolveAndConvertToDeepnote(QUARTO_FIXTURE)

        expect(result.format).toBe('quarto')
        expect(result.wasConverted).toBe(true)
        expect(result.file).toBeDefined()
        expect(result.file.project).toBeDefined()
        expect(result.originalPath).toContain('.qmd')
      })
    })

    describe('error handling', () => {
      it('throws FileResolutionError for non-existent files', async () => {
        await expect(resolveAndConvertToDeepnote('non-existent.deepnote')).rejects.toThrow(FileResolutionError)
      })

      it('throws FileResolutionError for unsupported extensions', async () => {
        await expect(resolveAndConvertToDeepnote('package.json')).rejects.toThrow(FileResolutionError)
        await expect(resolveAndConvertToDeepnote('package.json')).rejects.toThrow('Unsupported file type')
      })

      it('throws FileResolutionError for directories', async () => {
        await expect(resolveAndConvertToDeepnote('examples')).rejects.toThrow(FileResolutionError)
        await expect(resolveAndConvertToDeepnote('examples')).rejects.toThrow('Directory paths are not supported')
      })
    })
  })
})
