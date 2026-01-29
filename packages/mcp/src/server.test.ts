import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getServerMode, resetServerMode } from './server'
import { readingTools } from './tools/reading'
import { snapshotTools } from './tools/snapshots'

describe('server mode and tool filtering', () => {
  beforeEach(() => {
    resetServerMode()
  })

  afterEach(() => {
    resetServerMode()
  })

  describe('server mode state', () => {
    it('defaults to compact mode', () => {
      expect(getServerMode()).toBe('compact')
    })

    it('can be reset to compact', () => {
      // This test verifies resetServerMode works
      resetServerMode()
      expect(getServerMode()).toBe('compact')
    })
  })

  describe('compact mode hidden tools', () => {
    const COMPACT_HIDDEN_TOOLS = ['deepnote_inspect', 'deepnote_stats', 'deepnote_lint', 'deepnote_dag']

    it('reading tools include the tools that should be hidden in compact mode', () => {
      const names = readingTools.map(t => t.name)
      // Verify these tools exist in reading tools (they get filtered by server in compact mode)
      for (const hiddenTool of COMPACT_HIDDEN_TOOLS) {
        expect(names).toContain(hiddenTool)
      }
    })

    it('reading tools include deepnote_read as replacement', () => {
      const names = readingTools.map(t => t.name)
      expect(names).toContain('deepnote_read')
    })
  })
})

describe('compact parameter support', () => {
  describe('snapshot tools have compact parameter', () => {
    it('all snapshot tools support compact', () => {
      for (const tool of snapshotTools) {
        const schema = tool.inputSchema as { properties?: Record<string, unknown> }
        expect(schema.properties?.compact).toBeDefined()
      }
    })
  })

  describe('reading tools have compact parameter', () => {
    it('deepnote_read supports compact', () => {
      const tool = readingTools.find(t => t.name === 'deepnote_read')
      const schema = tool?.inputSchema as { properties?: Record<string, { type?: string }> }
      expect(schema?.properties?.compact).toBeDefined()
      expect(schema?.properties?.compact?.type).toBe('boolean')
    })
  })
})

describe('compact output format', () => {
  it('compact mode description mentions default true', () => {
    // Check that tools with compact parameter describe it as default: true
    const tool = readingTools.find(t => t.name === 'deepnote_read')
    const schema = tool?.inputSchema as { properties?: Record<string, { description?: string }> }
    const description = schema?.properties?.compact?.description || ''
    expect(description.toLowerCase()).toContain('default')
    expect(description.toLowerCase()).toContain('true')
  })
})
