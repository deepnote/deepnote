import { describe, expect, it } from 'vitest'
import { conversionTools } from './conversion'
import { executionTools } from './execution'
import { magicTools } from './magic'
import { readingTools } from './reading'
import { snapshotTools } from './snapshots'
import { writingTools } from './writing'

// Type helpers for testing schema properties
interface SchemaProperty {
  type?: string
  enum?: string[]
  items?: { type?: string; enum?: string[] }
}

interface InputSchema {
  type: string
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

describe('MCP tools definitions', () => {
  const allTools = [
    ...readingTools,
    ...writingTools,
    ...conversionTools,
    ...executionTools,
    ...magicTools,
    ...snapshotTools,
  ]

  describe('tool metadata', () => {
    it('all tools have unique names', () => {
      const names = allTools.map(t => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    })

    it('all tools have required fields', () => {
      for (const tool of allTools) {
        expect(tool.name).toBeDefined()
        expect(tool.name.startsWith('deepnote_')).toBe(true)
        expect(tool.description).toBeDefined()
        expect((tool.description ?? '').length).toBeGreaterThan(10)
        expect(tool.inputSchema).toBeDefined()
        expect(tool.inputSchema.type).toBe('object')
      }
    })

    it('all tools have annotations', () => {
      for (const tool of allTools) {
        expect(tool.annotations).toBeDefined()
        expect(typeof tool.annotations?.readOnlyHint).toBe('boolean')
        expect(typeof tool.annotations?.idempotentHint).toBe('boolean')
        expect(typeof tool.annotations?.openWorldHint).toBe('boolean')
      }
    })

    it('all tools have title field', () => {
      for (const tool of allTools) {
        expect(tool.title).toBeDefined()
        expect(tool.title?.length).toBeGreaterThan(0)
      }
    })
  })

  describe('reading tools', () => {
    it('has expected tools', () => {
      const names = readingTools.map(t => t.name)
      expect(names).toContain('deepnote_inspect')
      expect(names).toContain('deepnote_cat')
      expect(names).toContain('deepnote_lint')
      expect(names).toContain('deepnote_stats')
      expect(names).toContain('deepnote_analyze')
      expect(names).toContain('deepnote_dag')
      expect(names).toContain('deepnote_diff')
    })

    it('all reading tools are marked as read-only', () => {
      for (const tool of readingTools) {
        expect(tool.annotations?.readOnlyHint).toBe(true)
      }
    })

    it('all reading tools require path parameter', () => {
      const pathRequiredTools = [
        'deepnote_inspect',
        'deepnote_cat',
        'deepnote_lint',
        'deepnote_stats',
        'deepnote_analyze',
        'deepnote_dag',
      ]
      for (const name of pathRequiredTools) {
        const tool = readingTools.find(t => t.name === name)
        const schema = tool?.inputSchema as InputSchema
        expect(schema?.properties?.path).toBeDefined()
        expect(schema?.required).toContain('path')
      }
    })
  })

  describe('writing tools', () => {
    it('has expected tools', () => {
      const names = writingTools.map(t => t.name)
      expect(names).toContain('deepnote_create')
      expect(names).toContain('deepnote_add_block')
      expect(names).toContain('deepnote_edit_block')
      expect(names).toContain('deepnote_remove_block')
      expect(names).toContain('deepnote_reorder_blocks')
      expect(names).toContain('deepnote_add_notebook')
      expect(names).toContain('deepnote_bulk_edit')
    })

    it('all writing tools are NOT read-only', () => {
      for (const tool of writingTools) {
        expect(tool.annotations?.readOnlyHint).toBe(false)
      }
    })

    it('destructive tools are marked as destructive', () => {
      const destructiveTools = ['deepnote_remove_block', 'deepnote_bulk_edit']
      for (const name of destructiveTools) {
        const tool = writingTools.find(t => t.name === name)
        expect(tool?.annotations?.destructiveHint).toBe(true)
      }
    })
  })

  describe('conversion tools', () => {
    it('has expected tools', () => {
      const names = conversionTools.map(t => t.name)
      expect(names).toContain('deepnote_convert_to')
      expect(names).toContain('deepnote_convert_from')
      expect(names).toContain('deepnote_detect_format')
    })

    it('detect_format is read-only', () => {
      const tool = conversionTools.find(t => t.name === 'deepnote_detect_format')
      expect(tool?.annotations?.readOnlyHint).toBe(true)
    })

    it('conversion tools support multiple formats', () => {
      const convertTo = conversionTools.find(t => t.name === 'deepnote_convert_to')
      const schema = convertTo?.inputSchema as InputSchema
      const formats = schema?.properties?.format?.enum
      expect(formats).toContain('jupyter')
      expect(formats).toContain('quarto')
      expect(formats).toContain('percent')
      expect(formats).toContain('marimo')
    })
  })

  describe('execution tools', () => {
    it('has expected tools', () => {
      const names = executionTools.map(t => t.name)
      expect(names).toContain('deepnote_run')
      expect(names).toContain('deepnote_run_block')
    })

    it('execution tools have openWorldHint true', () => {
      for (const tool of executionTools) {
        expect(tool.annotations?.openWorldHint).toBe(true)
      }
    })

    it('execution tools are not idempotent', () => {
      for (const tool of executionTools) {
        expect(tool.annotations?.idempotentHint).toBe(false)
      }
    })
  })

  describe('magic tools', () => {
    it('has expected tools', () => {
      const names = magicTools.map(t => t.name)
      expect(names).toContain('deepnote_scaffold')
      expect(names).toContain('deepnote_enhance')
      expect(names).toContain('deepnote_fix')
      expect(names).toContain('deepnote_explain')
      expect(names).toContain('deepnote_suggest')
      expect(names).toContain('deepnote_template')
      expect(names).toContain('deepnote_refactor')
      expect(names).toContain('deepnote_profile')
      expect(names).toContain('deepnote_test')
      expect(names).toContain('deepnote_workflow')
    })

    it('scaffold tool has required parameters', () => {
      const tool = magicTools.find(t => t.name === 'deepnote_scaffold')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.required).toContain('description')
      expect(schema?.required).toContain('outputPath')
    })

    it('template tool supports expected templates', () => {
      const tool = magicTools.find(t => t.name === 'deepnote_template')
      const schema = tool?.inputSchema as InputSchema
      const templates = schema?.properties?.template?.enum
      expect(templates).toContain('dashboard')
      expect(templates).toContain('ml_pipeline')
      expect(templates).toContain('etl')
      expect(templates).toContain('report')
      expect(templates).toContain('api_client')
    })

    it('enhance tool supports enhancement types', () => {
      const tool = magicTools.find(t => t.name === 'deepnote_enhance')
      const schema = tool?.inputSchema as InputSchema
      const enhancements = schema?.properties?.enhancements
      expect(enhancements?.items?.enum).toContain('inputs')
      expect(enhancements?.items?.enum).toContain('documentation')
      expect(enhancements?.items?.enum).toContain('structure')
      expect(enhancements?.items?.enum).toContain('visualizations')
      expect(enhancements?.items?.enum).toContain('all')
    })

    it('workflow tool requires steps parameter', () => {
      const tool = magicTools.find(t => t.name === 'deepnote_workflow')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.required).toContain('steps')
    })
  })

  describe('snapshot tools', () => {
    it('has expected tools', () => {
      const names = snapshotTools.map(t => t.name)
      expect(names).toContain('deepnote_snapshot_list')
      expect(names).toContain('deepnote_snapshot_load')
      expect(names).toContain('deepnote_snapshot_split')
      expect(names).toContain('deepnote_snapshot_merge')
    })

    it('list and load tools are read-only', () => {
      const readOnlyTools = ['deepnote_snapshot_list', 'deepnote_snapshot_load']
      for (const name of readOnlyTools) {
        const tool = snapshotTools.find(t => t.name === name)
        expect(tool?.annotations?.readOnlyHint).toBe(true)
      }
    })

    it('split and merge tools are not read-only', () => {
      const writeTools = ['deepnote_snapshot_split', 'deepnote_snapshot_merge']
      for (const name of writeTools) {
        const tool = snapshotTools.find(t => t.name === name)
        expect(tool?.annotations?.readOnlyHint).toBe(false)
      }
    })

    it('snapshot tools require path parameter', () => {
      for (const tool of snapshotTools) {
        const schema = tool.inputSchema as InputSchema
        const required = schema?.required || []
        // All snapshot tools require some path parameter
        expect(required.some(r => r.includes('path') || r.includes('Path'))).toBe(true)
      }
    })
  })

  describe('validate tool', () => {
    it('exists in reading tools', () => {
      const names = readingTools.map(t => t.name)
      expect(names).toContain('deepnote_validate')
    })

    it('is read-only', () => {
      const tool = readingTools.find(t => t.name === 'deepnote_validate')
      expect(tool?.annotations?.readOnlyHint).toBe(true)
    })
  })

  describe('open tool', () => {
    it('exists in execution tools', () => {
      const names = executionTools.map(t => t.name)
      expect(names).toContain('deepnote_open')
    })

    it('has openWorldHint true (network access)', () => {
      const tool = executionTools.find(t => t.name === 'deepnote_open')
      expect(tool?.annotations?.openWorldHint).toBe(true)
    })

    it('is read-only (does not modify local files)', () => {
      const tool = executionTools.find(t => t.name === 'deepnote_open')
      expect(tool?.annotations?.readOnlyHint).toBe(true)
    })
  })

  describe('total tool count', () => {
    it('has correct number of tools', () => {
      expect(readingTools.length).toBe(8) // Added validate
      expect(writingTools.length).toBe(7)
      expect(conversionTools.length).toBe(3)
      expect(executionTools.length).toBe(3) // Added open
      expect(magicTools.length).toBe(10)
      expect(snapshotTools.length).toBe(4)
      expect(allTools.length).toBe(35)
    })
  })
})
