import { describe, expect, it } from 'vitest'
import { conversionTools } from './conversion'
import { executionTools } from './execution'
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
  const allTools = [...readingTools, ...writingTools, ...conversionTools, ...executionTools, ...snapshotTools]

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
      expect(names).toContain('deepnote_read')
      expect(names).toContain('deepnote_cat')
      expect(names).toContain('deepnote_validate')
      expect(names).toContain('deepnote_diff')
    })

    it('all reading tools are marked as read-only', () => {
      for (const tool of readingTools) {
        expect(tool.annotations?.readOnlyHint).toBe(true)
      }
    })

    it('all reading tools require path parameter', () => {
      for (const tool of readingTools) {
        const schema = tool.inputSchema as InputSchema
        const required = schema?.required || []
        expect(required.some(r => r.includes('path') || r.includes('Path'))).toBe(true)
      }
    })

    it('deepnote_read supports include parameter', () => {
      const tool = readingTools.find(t => t.name === 'deepnote_read')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.properties?.include).toBeDefined()
      expect(schema?.properties?.include?.items?.enum).toContain('structure')
      expect(schema?.properties?.include?.items?.enum).toContain('stats')
      expect(schema?.properties?.include?.items?.enum).toContain('lint')
      expect(schema?.properties?.include?.items?.enum).toContain('dag')
      expect(schema?.properties?.include?.items?.enum).toContain('all')
    })

    it('deepnote_read supports compact parameter', () => {
      const tool = readingTools.find(t => t.name === 'deepnote_read')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.properties?.compact).toBeDefined()
      expect(schema?.properties?.compact?.type).toBe('boolean')
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
    })

    it('all writing tools are NOT read-only', () => {
      for (const tool of writingTools) {
        expect(tool.annotations?.readOnlyHint).toBe(false)
      }
    })

    it('destructive tools are marked as destructive', () => {
      const tool = writingTools.find(t => t.name === 'deepnote_remove_block')
      expect(tool?.annotations?.destructiveHint).toBe(true)
    })
  })

  describe('conversion tools', () => {
    it('has expected tools', () => {
      const names = conversionTools.map(t => t.name)
      expect(names).toContain('deepnote_convert_to')
      expect(names).toContain('deepnote_convert_from')
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

    it('deepnote_run supports blockId parameter', () => {
      const tool = executionTools.find(t => t.name === 'deepnote_run')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.properties?.blockId).toBeDefined()
      expect(schema?.properties?.blockId?.type).toBe('string')
    })

    it('deepnote_run supports includeOutputSummary parameter', () => {
      const tool = executionTools.find(t => t.name === 'deepnote_run')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.properties?.includeOutputSummary).toBeDefined()
      expect(schema?.properties?.includeOutputSummary?.type).toBe('boolean')
    })

    it('deepnote_run supports compact parameter', () => {
      const tool = executionTools.find(t => t.name === 'deepnote_run')
      const schema = tool?.inputSchema as InputSchema
      expect(schema?.properties?.compact).toBeDefined()
      expect(schema?.properties?.compact?.type).toBe('boolean')
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

  describe('total tool count', () => {
    it('has correct number of tools', () => {
      expect(readingTools.length).toBe(4)
      expect(writingTools.length).toBe(6)
      expect(conversionTools.length).toBe(2)
      expect(executionTools.length).toBe(1)
      expect(snapshotTools.length).toBe(4)
      expect(allTools.length).toBe(17)
    })
  })
})
