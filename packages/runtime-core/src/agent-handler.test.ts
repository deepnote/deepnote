import type { DeepnoteFile, McpServerConfig } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSystemPrompt, mergeMcpConfigs, resolveEnvVars, serializeNotebookContext } from './agent-handler'

describe('resolveEnvVars', () => {
  beforeEach(() => {
    process.env.TEST_HOST = 'localhost'
    process.env.TEST_PORT = '5432'
  })

  afterEach(() => {
    delete process.env.TEST_HOST
    delete process.env.TEST_PORT
  })

  it('returns undefined for undefined input', () => {
    expect(resolveEnvVars(undefined)).toBeUndefined()
  })

  it('returns empty object for empty input', () => {
    expect(resolveEnvVars({})).toEqual({})
  })

  it('passes through literal values unchanged', () => {
    expect(resolveEnvVars({ KEY: 'value', OTHER: '123' })).toEqual({ KEY: 'value', OTHER: '123' })
  })

  it('resolves env var references from process.env', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var resolution
    const result = resolveEnvVars({ HOST: '${TEST_HOST}', PORT: '${TEST_PORT}' })
    expect(result).toEqual({ HOST: 'localhost', PORT: '5432' })
  })

  it('resolves missing env vars to empty string', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var resolution
    const result = resolveEnvVars({ MISSING: '${NONEXISTENT_VAR_XYZ}' })
    expect(result).toEqual({ MISSING: '' })
  })

  it('resolves mixed literal and env var values', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing env var resolution
    const result = resolveEnvVars({ URL: 'http://${TEST_HOST}:${TEST_PORT}/db' })
    expect(result).toEqual({ URL: 'http://localhost:5432/db' })
  })
})

function makeFile(overrides?: { blocks?: unknown[]; notebookName?: string; settings?: unknown }): DeepnoteFile {
  return {
    metadata: { createdAt: '2026-01-01T00:00:00Z' },
    project: {
      id: 'test',
      name: 'Test',
      notebooks: [
        {
          id: 'nb1',
          name: overrides?.notebookName ?? 'Notebook 1',
          blocks: (overrides?.blocks as DeepnoteFile['project']['notebooks'][0]['blocks']) ?? [],
        },
      ],
      settings: overrides?.settings as DeepnoteFile['project']['settings'],
    },
    version: '1.0.0',
  }
}

describe('serializeNotebookContext', () => {
  it('returns "Empty notebook." for invalid notebook index', () => {
    const file = makeFile()
    expect(serializeNotebookContext(file, 99, new Map())).toBe('Empty notebook.')
  })

  it('includes notebook name in header', () => {
    const file = makeFile({ notebookName: 'My Analysis' })
    const result = serializeNotebookContext(file, 0, new Map())
    expect(result).toContain('# Notebook: My Analysis')
  })

  it('serializes block content in code fences', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'block1234abcd',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: 'print("hello")',
          metadata: {},
          executionCount: null,
          outputs: [],
        },
      ],
    })
    const result = serializeNotebookContext(file, 0, new Map())
    expect(result).toContain('## Block [code] (id: block123)')
    expect(result).toContain('```')
    expect(result).toContain('print("hello")')
  })

  it('serializes stream output', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'block1234abcd',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: 'print("hi")',
          metadata: {},
          executionCount: 1,
          outputs: [],
        },
      ],
    })
    const outputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()
    outputs.set('block1234abcd', {
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }],
      executionCount: 1,
    })
    const result = serializeNotebookContext(file, 0, outputs)
    expect(result).toContain('### Output:')
    expect(result).toContain('hi\n')
  })

  it('serializes execute_result with text/plain', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'exec-result-1234',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: '42',
          metadata: {},
          executionCount: 1,
          outputs: [],
        },
      ],
    })
    const outputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()
    outputs.set('exec-result-1234', {
      outputs: [{ output_type: 'execute_result', data: { 'text/plain': '42' } }],
      executionCount: 1,
    })
    const result = serializeNotebookContext(file, 0, outputs)
    expect(result).toContain('42')
  })

  it('serializes display_data with text/html as placeholder', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'html-block-12345',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: 'display(html)',
          metadata: {},
          executionCount: 1,
          outputs: [],
        },
      ],
    })
    const outputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()
    outputs.set('html-block-12345', {
      outputs: [{ output_type: 'display_data', data: { 'text/html': '<table>...</table>' } }],
      executionCount: 1,
    })
    const result = serializeNotebookContext(file, 0, outputs)
    expect(result).toContain('[HTML output]')
  })

  it('serializes image output as placeholder', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'img-block-123456',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: 'plt.show()',
          metadata: {},
          executionCount: 1,
          outputs: [],
        },
      ],
    })
    const outputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()
    outputs.set('img-block-123456', {
      outputs: [{ output_type: 'display_data', data: { 'image/png': 'base64data...' } }],
      executionCount: 1,
    })
    const result = serializeNotebookContext(file, 0, outputs)
    expect(result).toContain('[Image output]')
  })

  it('serializes error output', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'err-block-123456',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'code',
          content: '1/0',
          metadata: {},
          executionCount: 1,
          outputs: [],
        },
      ],
    })
    const outputs = new Map<string, { outputs: unknown[]; executionCount: number | null }>()
    outputs.set('err-block-123456', {
      outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero' }],
      executionCount: 1,
    })
    const result = serializeNotebookContext(file, 0, outputs)
    expect(result).toContain('Error: ZeroDivisionError: division by zero')
  })

  it('handles blocks without content', () => {
    const file = makeFile({
      blocks: [
        {
          id: 'no-content-12345',
          blockGroup: 'bg1',
          sortingKey: 'a0',
          type: 'markdown',
          metadata: {},
        },
      ],
    })
    const result = serializeNotebookContext(file, 0, new Map())
    expect(result).toContain('## Block [markdown]')
    expect(result).not.toContain('```')
  })
})

describe('buildSystemPrompt', () => {
  it('includes notebook context', () => {
    const prompt = buildSystemPrompt('# Notebook: Test\n\nsome context')
    expect(prompt).toContain('# Notebook: Test')
    expect(prompt).toContain('some context')
  })

  it('includes standard instructions', () => {
    const prompt = buildSystemPrompt('')
    expect(prompt).toContain('add_code_block')
    expect(prompt).toContain('add_markdown_block')
    expect(prompt).toContain('data science assistant')
  })

  it('omits integrations section when no integrations provided', () => {
    const prompt = buildSystemPrompt('context')
    expect(prompt).not.toContain('Available database integrations')
  })

  it('omits integrations section when empty array provided', () => {
    const prompt = buildSystemPrompt('context', [])
    expect(prompt).not.toContain('Available database integrations')
  })

  it('includes integrations section when integrations are present', () => {
    const integrations = [
      { id: 'pg-1', name: 'Production Postgres', type: 'pgsql' },
      { id: 'sf-1', name: 'Snowflake DW', type: 'snowflake' },
    ]
    const prompt = buildSystemPrompt('context', integrations)
    expect(prompt).toContain('## Available database integrations')
    expect(prompt).toContain('"Production Postgres" (pgsql, id: pg-1)')
    expect(prompt).toContain('"Snowflake DW" (snowflake, id: sf-1)')
    expect(prompt).toContain('dntk.execute_sql')
  })
})

describe('mergeMcpConfigs', () => {
  const serverA: McpServerConfig = { name: 'server-a', command: 'cmd-a' }
  const serverB: McpServerConfig = { name: 'server-b', command: 'cmd-b', args: ['--flag'] }

  it('returns empty array when both inputs are empty', () => {
    expect(mergeMcpConfigs([], [])).toEqual([])
  })

  it('returns project servers when block servers are empty', () => {
    expect(mergeMcpConfigs([serverA, serverB], [])).toEqual([serverA, serverB])
  })

  it('returns block servers when project servers are empty', () => {
    expect(mergeMcpConfigs([], [serverA])).toEqual([serverA])
  })

  it('block servers override project servers with the same name', () => {
    const blockOverride: McpServerConfig = { name: 'server-a', command: 'override-cmd' }
    const result = mergeMcpConfigs([serverA, serverB], [blockOverride])
    expect(result).toHaveLength(2)
    expect(result.find(s => s.name === 'server-a')?.command).toBe('override-cmd')
    expect(result.find(s => s.name === 'server-b')?.command).toBe('cmd-b')
  })

  it('merges unique servers from both sources', () => {
    const serverC: McpServerConfig = { name: 'server-c', command: 'cmd-c' }
    const result = mergeMcpConfigs([serverA], [serverC])
    expect(result).toHaveLength(2)
    expect(result.map(s => s.name).sort()).toEqual(['server-a', 'server-c'])
  })
})
