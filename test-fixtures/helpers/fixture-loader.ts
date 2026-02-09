import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Root directory for shared test fixtures
 */
export const FIXTURES_ROOT = path.join(__dirname, '..')

/**
 * Get the absolute path to a fixture file
 */
export function getFixturePath(category: string, filename: string): string {
  return path.join(FIXTURES_ROOT, category, filename)
}

/**
 * Load a fixture file as a string
 */
export async function loadFixture(category: string, filename: string): Promise<string> {
  const filePath = getFixturePath(category, filename)
  return fs.readFile(filePath, 'utf-8')
}

/**
 * Load a Marimo format fixture (.marimo.py)
 */
export async function loadMarimoFixture(filename: string): Promise<string> {
  return loadFixture('formats/marimo', filename)
}

/**
 * Load a percent format fixture (.percent.py)
 */
export async function loadPercentFixture(filename: string): Promise<string> {
  return loadFixture('formats/percent', filename)
}

/**
 * Load a Quarto format fixture (.qmd)
 */
export async function loadQuartoFixture(filename: string): Promise<string> {
  return loadFixture('formats/quarto', filename)
}

/**
 * Load a Jupyter notebook fixture (.ipynb) and parse as JSON
 */
export async function loadJupyterFixture(filename: string): Promise<unknown> {
  const content = await loadFixture('formats/jupyter', filename)
  return JSON.parse(content)
}

/**
 * Load a Deepnote fixture (.deepnote)
 */
export async function loadDeepnoteFixture(filename: string): Promise<string> {
  return loadFixture('formats/deepnote', filename)
}

/**
 * Load an edge case fixture
 */
export async function loadEdgeCaseFixture(filename: string): Promise<string> {
  return loadFixture('edge-cases', filename)
}

/**
 * Load a diff test fixture (.deepnote)
 */
export async function loadDiffFixture(filename: string): Promise<string> {
  return loadFixture('diff', filename)
}

/**
 * Get the absolute path to a diff test fixture
 */
export function getDiffFixturePath(filename: string): string {
  return getFixturePath('diff', filename)
}

/**
 * Load a test fixture from the root fixtures directory
 */
export async function loadRootFixture(filename: string): Promise<string> {
  const filePath = path.join(FIXTURES_ROOT, filename)
  return fs.readFile(filePath, 'utf-8')
}

/**
 * Get the absolute path to a fixture in the root fixtures directory
 */
export function getRootFixturePath(filename: string): string {
  return path.join(FIXTURES_ROOT, filename)
}
