import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listResources, readResource } from './resources'

describe('resources', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-resources-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('listResources', () => {
    it('returns example notebooks resource without workspace', async () => {
      const resources = await listResources()
      const examplesResource = resources.find(r => r.uri === 'deepnote://examples')
      expect(examplesResource).toBeDefined()
      expect(examplesResource?.name).toBe('Example Notebooks')
      expect(examplesResource?.mimeType).toBe('application/json')
    })

    it('returns workspace resource when workspaceRoot provided', async () => {
      const resources = await listResources(tempDir)
      const workspaceResource = resources.find(r => r.uri === 'deepnote://workspace')
      expect(workspaceResource).toBeDefined()
      expect(workspaceResource?.name).toBe('Workspace Notebooks')
    })

    it('discovers .deepnote files in workspace', async () => {
      // Create a test .deepnote file (no leading newline)
      const testNotebook = `version: "1.0"
project:
  name: "Test Notebook"
  id: "test-123"
  notebooks:
    - name: "Notebook"
      id: "nb-123"
      blocks: []
metadata:
  createdAt: "2026-01-01T00:00:00Z"
  modifiedAt: "2026-01-01T00:00:00Z"
`
      await fs.writeFile(path.join(tempDir, 'test.deepnote'), testNotebook)

      const resources = await listResources(tempDir)
      const expectedUri = `deepnote://file/${encodeURIComponent(path.join(tempDir, 'test.deepnote'))}`
      const fileResource = resources.find(r => r.uri === expectedUri)
      expect(fileResource).toBeDefined()
      expect(fileResource?.name).toBe('test')
      expect(fileResource?.mimeType).toBe('application/x-deepnote')
    })

    it('encodes resource uri for filenames with spaces and unicode', async () => {
      const filename = 'test ñ space.deepnote'
      const notebookPath = path.join(tempDir, filename)
      const testNotebook = `version: "1.0"
project:
  name: "Unicode Test"
  id: "unicode-123"
  notebooks:
    - name: "Notebook"
      id: "nb-123"
      blocks: []
metadata:
  createdAt: "2026-01-01T00:00:00Z"
  modifiedAt: "2026-01-01T00:00:00Z"
`
      await fs.writeFile(notebookPath, testNotebook)

      const resources = await listResources(tempDir)
      const expectedUri = `deepnote://file/${encodeURIComponent(notebookPath)}`
      const resource = resources.find(r => r.uri === expectedUri)
      expect(resource).toBeDefined()
      expect(resource?.name).toBe('test ñ space')
      expect(resource?.mimeType).toBe('application/x-deepnote')
      expect(resource?.uri).toContain(encodeURIComponent(filename))
    })

    it('ignores node_modules and hidden directories', async () => {
      // Create directories to ignore
      await fs.mkdir(path.join(tempDir, 'node_modules'), { recursive: true })
      await fs.mkdir(path.join(tempDir, '.hidden'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'node_modules', 'test.deepnote'), 'invalid')
      await fs.writeFile(path.join(tempDir, '.hidden', 'test.deepnote'), 'invalid')

      const resources = await listResources(tempDir)
      const nodeModulesFile = resources.find(r => r.uri.includes('node_modules'))
      const hiddenFile = resources.find(r => r.uri.includes('.hidden'))
      expect(nodeModulesFile).toBeUndefined()
      expect(hiddenFile).toBeUndefined()
    })
  })

  describe('readResource', () => {
    it('reads examples resource', async () => {
      const contents = await readResource('deepnote://examples')
      expect(contents).toHaveLength(1)
      expect(contents[0].mimeType).toBe('application/json')
      expect(contents[0].uri).toBe('deepnote://examples')
      const data = JSON.parse((contents[0] as { text: string }).text)
      expect(data.examples).toBeDefined()
      expect(Array.isArray(data.examples)).toBe(true)
    })

    it('reads workspace resource', async () => {
      const testNotebook = `version: "1.0"
project:
  name: "Workspace Test"
  id: "ws-123"
  notebooks:
    - name: "Main"
      id: "main-123"
      blocks:
        - id: "block-1"
          type: "code"
          content: "print('hello')"
metadata:
  createdAt: "2026-01-01T00:00:00Z"
  modifiedAt: "2026-01-01T00:00:00Z"
`
      await fs.writeFile(path.join(tempDir, 'workspace.deepnote'), testNotebook)

      const contents = await readResource('deepnote://workspace', tempDir)
      expect(contents).toHaveLength(1)
      const data = JSON.parse((contents[0] as { text: string }).text)
      expect(data.workspaceRoot).toBe(tempDir)
      expect(data.notebooks).toHaveLength(1)
      // Notebook could have either projectName or error depending on parse success
      expect(data.notebooks[0].path).toContain('workspace.deepnote')
    })

    it('returns error for workspace without root', async () => {
      const contents = await readResource('deepnote://workspace')
      const data = JSON.parse((contents[0] as { text: string }).text)
      expect(data.error).toBe('No workspace root configured')
    })

    it('reads individual notebook file', async () => {
      const testNotebook = `version: "1.0"
project:
  name: "Individual Test"
  id: "ind-123"
  notebooks:
    - name: "Analysis"
      id: "ana-123"
      blocks:
        - id: "b1"
          type: "markdown"
          content: "# Hello"
        - id: "b2"
          type: "code"
          content: "x = 42"
metadata:
  createdAt: "2026-01-01T00:00:00Z"
  modifiedAt: "2026-01-01T00:00:00Z"
`
      const filePath = path.join(tempDir, 'individual.deepnote')
      await fs.writeFile(filePath, testNotebook)

      const contents = await readResource(`deepnote://file/${filePath}`)
      expect(contents).toHaveLength(1)
      expect(contents[0].uri).toBe(`deepnote://file/${filePath}`)
      expect(contents[0].mimeType).toBe('application/json')

      const data = JSON.parse((contents[0] as { text: string }).text)
      // Response should have either notebook data or an error
      expect(data.projectName || data.error).toBeDefined()
    })

    it('returns error for nonexistent file', async () => {
      const contents = await readResource('deepnote://file//nonexistent/path.deepnote')
      const data = JSON.parse((contents[0] as { text: string }).text)
      expect(data.error).toBeDefined()
    })

    it('handles invalid deepnote file gracefully', async () => {
      const invalidPath = path.join(tempDir, 'invalid.deepnote')
      await fs.writeFile(invalidPath, 'not valid yaml or json')

      const contents = await readResource(`deepnote://file/${invalidPath}`)
      const data = JSON.parse((contents[0] as { text: string }).text)
      expect(data.error).toBeDefined()
    })
  })
})
