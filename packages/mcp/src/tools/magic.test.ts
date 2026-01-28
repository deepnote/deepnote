import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleMagicTool } from './magic'

// Helper to extract result from MCP response
function extractResult(response: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(response.content[0].text)
}

describe('magic tools handlers', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-magic-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('deepnote_scaffold', () => {
    it('creates a notebook from description', async () => {
      const outputPath = path.join(tempDir, 'test.deepnote')
      const response = await handleMagicTool('deepnote_scaffold', {
        description: 'Simple data analysis notebook',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)

      // Verify file was created
      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)
      expect(deepnote.project.name).toBeDefined()
      expect(deepnote.project.notebooks.length).toBeGreaterThan(0)
    })

    it('creates documented style notebook', async () => {
      const outputPath = path.join(tempDir, 'documented.deepnote')
      const response = await handleMagicTool('deepnote_scaffold', {
        description: 'ML pipeline with data preprocessing',
        outputPath,
        style: 'documented',
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)

      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)

      // Should have markdown blocks for documentation
      const blocks = deepnote.project.notebooks[0].blocks
      const markdownBlocks = blocks.filter(b => b.type === 'markdown' || b.type.startsWith('text-cell'))
      expect(markdownBlocks.length).toBeGreaterThan(0)
    })

    it('creates minimal style notebook', async () => {
      const outputPath = path.join(tempDir, 'minimal.deepnote')
      const response = await handleMagicTool('deepnote_scaffold', {
        description: 'Quick script',
        outputPath,
        style: 'minimal',
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)

      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)

      // Should have fewer blocks
      const blocks = deepnote.project.notebooks[0].blocks
      expect(blocks.length).toBeLessThan(20)
    })
  })

  describe('deepnote_template', () => {
    it('creates dashboard template', async () => {
      const outputPath = path.join(tempDir, 'dashboard.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'dashboard',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.template).toBe('dashboard')

      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)
      expect(deepnote.project.name).toBe('Dashboard')

      // Dashboard should have input blocks
      const blocks = deepnote.project.notebooks[0].blocks
      const inputBlocks = blocks.filter(b => b.type.startsWith('input-'))
      expect(inputBlocks.length).toBeGreaterThan(0)
    })

    it('creates ETL template', async () => {
      const outputPath = path.join(tempDir, 'etl.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'etl',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.template).toBe('etl')

      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)
      expect(deepnote.project.name).toBe('Etl')
    })

    it('creates ml_pipeline template', async () => {
      const outputPath = path.join(tempDir, 'ml.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'ml_pipeline',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.template).toBe('ml_pipeline')
    })

    it('creates report template', async () => {
      const outputPath = path.join(tempDir, 'report.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'report',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.template).toBe('report')
    })

    it('creates api_client template', async () => {
      const outputPath = path.join(tempDir, 'api.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'api_client',
        outputPath,
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.template).toBe('api_client')
    })

    it('supports custom project name', async () => {
      const outputPath = path.join(tempDir, 'custom.deepnote')
      const response = await handleMagicTool('deepnote_template', {
        template: 'dashboard',
        outputPath,
        projectName: 'My Custom Dashboard',
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)
      expect(result.projectName).toBe('My Custom Dashboard')

      const content = await fs.readFile(outputPath, 'utf-8')
      const deepnote = deserializeDeepnoteFile(content)
      expect(deepnote.project.name).toBe('My Custom Dashboard')
    })
  })

  describe('deepnote_explain', () => {
    it('generates explanation for notebook in JSON format', async () => {
      // First create a notebook
      const notebookPath = path.join(tempDir, 'to_explain.deepnote')
      await handleMagicTool('deepnote_scaffold', {
        description: 'Data analysis with pandas',
        outputPath: notebookPath,
      })

      const response = await handleMagicTool('deepnote_explain', {
        path: notebookPath,
        format: 'json',
      })

      const result = extractResult(response)
      expect(result.projectName).toBeDefined()
      expect(result.explanation).toBeDefined()
      expect(typeof result.explanation).toBe('string')
    })

    it('generates markdown explanation for notebook', async () => {
      const notebookPath = path.join(tempDir, 'to_explain_md.deepnote')
      await handleMagicTool('deepnote_scaffold', {
        description: 'Simple notebook',
        outputPath: notebookPath,
      })

      const response = await handleMagicTool('deepnote_explain', {
        path: notebookPath,
        format: 'markdown',
      })

      // Markdown format returns raw text, not JSON
      expect(response.content[0].text).toContain('#')
      expect(response.content[0].text).toContain('Overview')
    })
  })

  describe('deepnote_suggest', () => {
    it('provides suggestions for notebook', async () => {
      // First create a notebook
      const notebookPath = path.join(tempDir, 'to_suggest.deepnote')
      await handleMagicTool('deepnote_scaffold', {
        description: 'Basic notebook',
        outputPath: notebookPath,
        style: 'minimal',
      })

      const response = await handleMagicTool('deepnote_suggest', {
        path: notebookPath,
      })

      const result = extractResult(response)
      expect(result.suggestions).toBeDefined()
      expect(Array.isArray(result.suggestions)).toBe(true)
    })
  })

  describe('deepnote_enhance', () => {
    it('enhances notebook with documentation', async () => {
      // First create a minimal notebook
      const notebookPath = path.join(tempDir, 'to_enhance.deepnote')
      await handleMagicTool('deepnote_scaffold', {
        description: 'Simple script',
        outputPath: notebookPath,
        style: 'minimal',
      })

      const beforeContent = await fs.readFile(notebookPath, 'utf-8')
      const beforeDeepnote = deserializeDeepnoteFile(beforeContent)
      const beforeBlockCount = beforeDeepnote.project.notebooks[0].blocks.length

      const response = await handleMagicTool('deepnote_enhance', {
        path: notebookPath,
        enhancements: ['documentation'],
      })

      const result = extractResult(response)
      expect(result.success).toBe(true)

      const afterContent = await fs.readFile(notebookPath, 'utf-8')
      const afterDeepnote = deserializeDeepnoteFile(afterContent)
      const afterBlockCount = afterDeepnote.project.notebooks[0].blocks.length

      // Should have added blocks
      expect(afterBlockCount).toBeGreaterThanOrEqual(beforeBlockCount)
    })
  })

  describe('error handling', () => {
    it('returns error for unknown tool', async () => {
      const response = (await handleMagicTool('deepnote_unknown', {})) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(response.isError).toBe(true)
      expect(response.content[0].text).toContain('Unknown magic tool')
    })

    it('throws for missing required parameters', async () => {
      // scaffold throws when required params are missing (not wrapped in error response)
      await expect(
        handleMagicTool('deepnote_scaffold', {
          // missing description and outputPath
        })
      ).rejects.toThrow()
    })

    it('throws for nonexistent file', async () => {
      // explain throws when file doesn't exist (not wrapped in error response)
      await expect(
        handleMagicTool('deepnote_explain', {
          path: '/nonexistent/path.deepnote',
        })
      ).rejects.toThrow()
    })
  })
})
