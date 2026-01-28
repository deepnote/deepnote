import { describe, expect, it } from 'vitest'
import {
  FIXTURES_ROOT,
  getFixturePath,
  loadDeepnoteFixture,
  loadJupyterFixture,
  loadMarimoFixture,
  loadPercentFixture,
  loadQuartoFixture,
} from './fixture-loader'

describe('fixture-loader', () => {
  describe('FIXTURES_ROOT', () => {
    it('points to test-fixtures directory', () => {
      expect(FIXTURES_ROOT).toContain('test-fixtures')
    })
  })

  describe('getFixturePath', () => {
    it('returns path to fixture file', () => {
      const path = getFixturePath('formats/marimo', 'basic-app.marimo.py')
      expect(path).toContain('test-fixtures')
      expect(path).toContain('formats/marimo')
      expect(path).toContain('basic-app.marimo.py')
    })
  })

  describe('loadMarimoFixture', () => {
    it('loads a Marimo fixture file', async () => {
      const content = await loadMarimoFixture('basic-app.marimo.py')
      expect(content).toContain('import marimo')
      expect(content).toContain('@app.cell')
    })
  })

  describe('loadPercentFixture', () => {
    it('loads a percent format fixture file', async () => {
      const content = await loadPercentFixture('basic-cells.percent.py')
      expect(content).toContain('# %%')
      expect(content).toContain('print("hello")')
    })
  })

  describe('loadQuartoFixture', () => {
    it('loads a Quarto fixture file', async () => {
      const content = await loadQuartoFixture('basic.qmd')
      expect(content).toContain('```{python}')
      expect(content).toContain('print("hello")')
    })
  })

  describe('loadJupyterFixture', () => {
    it('loads and parses a Jupyter notebook fixture', async () => {
      const notebook = (await loadJupyterFixture('basic.ipynb')) as {
        cells: Array<{ cell_type: string }>
        nbformat: number
      }
      expect(notebook).toHaveProperty('cells')
      expect(notebook).toHaveProperty('nbformat')
      expect(notebook.cells.length).toBeGreaterThan(0)
    })
  })

  describe('loadDeepnoteFixture', () => {
    it('loads a Deepnote fixture file', async () => {
      const content = await loadDeepnoteFixture('with-inputs.deepnote')
      expect(content).toContain('project:')
      expect(content).toContain('notebooks:')
    })
  })
})
