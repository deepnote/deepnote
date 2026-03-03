import { describe, expect, it } from 'vitest'
import { deepnoteBlockSchema } from '../deepnote-file/deepnote-file-schema'
import { isLlmBlock } from './llm-blocks'

describe('llm block schema', () => {
  it('parses a minimal llm block', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'llm',
      content: 'Analyze the data',
      metadata: {},
      executionCount: null,
      outputs: [],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('llm')
      expect(result.data.content).toBe('Analyze the data')
    }
  })

  it('applies default metadata values', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'llm',
      content: 'test prompt',
      executionCount: null,
      outputs: [],
    })

    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'llm') {
      expect(result.data.metadata.deepnote_model).toBe('auto')
      expect(result.data.metadata.deepnote_max_iterations).toBe(10)
    }
  })

  it('parses llm block with MCP servers', () => {
    const result = deepnoteBlockSchema.safeParse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'llm',
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
    if (result.success && result.data.type === 'llm') {
      expect(result.data.metadata.deepnote_model).toBe('gpt-4o-mini')
      expect(result.data.metadata.deepnote_max_iterations).toBe(5)
      expect(result.data.metadata.deepnote_mcp_servers).toHaveLength(1)
      expect(result.data.metadata.deepnote_mcp_servers?.[0]?.name).toBe('postgres')
    }
  })
})

describe('isLlmBlock', () => {
  it('returns true for llm blocks', () => {
    const block = deepnoteBlockSchema.parse({
      id: 'abc123',
      blockGroup: 'grp123',
      sortingKey: 'a0',
      type: 'llm',
      content: 'test',
      executionCount: null,
      outputs: [],
    })

    expect(isLlmBlock(block)).toBe(true)
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

    expect(isLlmBlock(block)).toBe(false)
  })
})
