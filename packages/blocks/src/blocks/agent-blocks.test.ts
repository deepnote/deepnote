import { describe, expect, it } from 'vitest'
import { deepnoteBlockSchema } from '../deepnote-file/deepnote-file-schema'
import { isAgentBlock } from './agent-blocks'

describe('agent block schema', () => {
  it('parses a minimal agent block', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'agent',
      content: 'Analyze the data',
      metadata: {},
      executionCount: null,
      outputs: [],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('agent')
      expect(result.data.content).toBe('Analyze the data')
    }
  })

  it('applies default metadata values', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'agent',
      content: 'test prompt',
      executionCount: null,
      outputs: [],
    })

    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'agent') {
      expect(result.data.metadata.deepnote_model).toBe('auto')
      expect(result.data.metadata.deepnote_max_iterations).toBe(10)
    }
  })

  it('parses agent block with MCP servers', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'agent',
      content: 'query the db',
      metadata: {
        deepnote_model: 'gpt-4o-mini',
        deepnote_max_iterations: 5,
        deepnote_mcp_servers: [
          {
            name: 'postgres',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres'],
            // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var reference syntax
            env: { DATABASE_URL: '${DATABASE_URL}' },
          },
        ],
      },
      executionCount: null,
      outputs: [],
    })

    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'agent') {
      expect(result.data.metadata.deepnote_model).toBe('gpt-4o-mini')
      expect(result.data.metadata.deepnote_max_iterations).toBe(5)
      expect(result.data.metadata.deepnote_mcp_servers).toHaveLength(1)
      expect(result.data.metadata.deepnote_mcp_servers?.[0]?.name).toBe('postgres')
    }
  })
})

describe('isAgentBlock', () => {
  it('returns true for agent blocks', () => {
    const block = deepnoteBlockSchema.parse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'agent',
      content: 'test',
      executionCount: null,
      outputs: [],
    })

    expect(isAgentBlock(block)).toBe(true)
  })

  it('returns false for code blocks', () => {
    const block = deepnoteBlockSchema.parse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'code',
      content: 'print("hello")',
      executionCount: null,
      outputs: [],
    })

    expect(isAgentBlock(block)).toBe(false)
  })
})
