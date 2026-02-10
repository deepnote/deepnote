import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleReadingTool } from './reading'
import { handleWritingTool } from './writing'

// Helper to extract result from MCP response
function extractResult(response: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

describe('reading tools handlers', () => {
  let tempDir: string
  let testNotebookPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-reading-test-'))

    // Create a test notebook using the writing tool
    testNotebookPath = path.join(tempDir, 'test.deepnote')
    await handleWritingTool('deepnote_create', {
      outputPath: testNotebookPath,
      projectName: 'Test Project',
      notebooks: [
        {
          name: 'Notebook',
          blocks: [{ type: 'code', content: 'import pandas as pd\ndf = pd.DataFrame({"a": [1,2,3]})\nprint(df)' }],
        },
      ],
    })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('deepnote_read', () => {
    it('returns structure by default', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
      })

      const result = extractResult(response)
      expect(result.path).toBe(testNotebookPath)
      expect(result.structure).toBeDefined()
      expect(result.stats).toBeUndefined()
      expect(result.lint).toBeUndefined()
      expect(result.dag).toBeUndefined()
    })

    it('includes stats when requested', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['stats'],
      })

      const result = extractResult(response)
      expect(result.stats).toBeDefined()
      const stats = result.stats as Record<string, unknown>
      expect(stats.totalLines).toBeDefined()
      expect(stats.importCount).toBeDefined()
    })

    it('includes lint when requested', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['lint'],
      })

      const result = extractResult(response)
      expect(result.lint).toBeDefined()
      const lint = result.lint as Record<string, unknown>
      expect(lint.issueCount).toBeDefined()
    })

    it('includes dag when requested', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['dag'],
      })

      const result = extractResult(response)
      expect(result.dag).toBeDefined()
      expect(Array.isArray(result.dag)).toBe(true)
    })

    it('includes all sections when all is specified', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['all'],
      })

      const result = extractResult(response)
      expect(result.structure).toBeDefined()
      expect(result.stats).toBeDefined()
      expect(result.lint).toBeDefined()
      expect(result.dag).toBeDefined()
    })

    it('combines multiple includes', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['structure', 'stats'],
      })

      const result = extractResult(response)
      expect(result.structure).toBeDefined()
      expect(result.stats).toBeDefined()
      expect(result.lint).toBeUndefined()
      expect(result.dag).toBeUndefined()
    })

    it('supports compact mode', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['structure'],
        compact: true,
      })

      // Compact mode should not have pretty-printed JSON (no newlines)
      expect(response.content[0].text).not.toContain('\n')
      const result = extractResult(response)
      expect(result.path).toBe(testNotebookPath)
    })

    it('structure includes project info', async () => {
      const response = await handleReadingTool('deepnote_read', {
        path: testNotebookPath,
        include: ['structure'],
      })

      const result = extractResult(response)
      const structure = result.structure as Record<string, unknown>
      expect(structure.projectName).toBeDefined()
      expect(structure.projectId).toBeDefined()
      expect(structure.notebooks).toBeDefined()
      expect(structure.totalBlocks).toBeDefined()
      expect(structure.blockCounts).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('returns error for unknown tool', async () => {
      const response = (await handleReadingTool('deepnote_unknown', {})) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Unknown reading tool')
    })

    it('throws for nonexistent file', async () => {
      await expect(
        handleReadingTool('deepnote_read', {
          path: '/nonexistent/path.deepnote',
        })
      ).rejects.toThrow()
    })
  })
})
