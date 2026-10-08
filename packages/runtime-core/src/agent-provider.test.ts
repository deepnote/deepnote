import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AgentProviderId,
  getAgentApiKeyEnvVar,
  parseAgentModel,
  type ResolvedAgentModel,
  resolveAgentModel,
} from './agent-provider'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Sends one request with the network disabled and returns what would have been sent. */
async function captureRequest({ model, providerOptions }: ResolvedAgentModel) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Network disabled in test'))
  vi.stubGlobal('fetch', fetch)
  if (typeof model === 'string' || model.specificationVersion !== 'v4') {
    throw new Error('Expected a v4 provider')
  }
  await expect(
    model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Use the tool' }] }],
      tools: [{ type: 'function', name: 'noop', inputSchema: { type: 'object', properties: {} } }],
      providerOptions,
    })
  ).rejects.toThrow('Network disabled in test')
  expect(fetch).toHaveBeenCalledOnce()
  const [url, init] = fetch.mock.calls[0] ?? []
  return { url, headers: init?.headers as Record<string, string>, body: JSON.parse(init?.body as string) }
}

describe('parseAgentModel', () => {
  it('defaults to openai/auto when no model is set', () => {
    expect(parseAgentModel(undefined)).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('')).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('   ')).toEqual({ providerId: 'openai', modelName: 'auto' })
  })

  it('treats a bare model name as openai, so existing files keep working', () => {
    expect(parseAgentModel('auto')).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('gpt-6.1-sol')).toEqual({ providerId: 'openai', modelName: 'gpt-6.1-sol' })
    expect(parseAgentModel('gpt-5')).toEqual({ providerId: 'openai', modelName: 'gpt-5' })
    expect(parseAgentModel('gpt-5.6-sol')).toEqual({ providerId: 'openai', modelName: 'gpt-5.6-sol' })
  })

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'])('infers Anthropic for bare %s', modelName => {
    expect(parseAgentModel(modelName)).toEqual({ providerId: 'anthropic', modelName })
  })

  it.each(['default', ' default ', 'openai:default'])('accepts Cloud default sentinel %s', spec => {
    expect(parseAgentModel(spec)).toEqual({ providerId: 'openai', modelName: 'auto' })
  })

  it('splits a known provider prefix', () => {
    expect(parseAgentModel('anthropic:claude-opus-5-5')).toEqual({
      providerId: 'anthropic',
      modelName: 'claude-opus-5-5',
    })
    expect(parseAgentModel('openai:gpt-6.1-sol')).toEqual({ providerId: 'openai', modelName: 'gpt-6.1-sol' })
    expect(parseAgentModel('openai-compatible:llama4')).toEqual({
      providerId: 'openai-compatible',
      modelName: 'llama4',
    })
  })

  it('leaves slash-separated aggregator ids intact', () => {
    expect(parseAgentModel('openai-compatible:anthropic/claude-opus-5.5')).toEqual({
      providerId: 'openai-compatible',
      modelName: 'anthropic/claude-opus-5.5',
    })
    expect(parseAgentModel('anthropic/claude-opus-5.5')).toEqual({
      providerId: 'openai',
      modelName: 'anthropic/claude-opus-5.5',
    })
  })

  it('keeps an unknown prefix as part of the model name', () => {
    // A colon is legal in a model name; only a known provider id is a prefix.
    expect(parseAgentModel('mistral:large')).toEqual({ providerId: 'openai', modelName: 'mistral:large' })
  })

  it('falls back to auto when a provider prefix has no model', () => {
    expect(parseAgentModel('anthropic:')).toEqual({ providerId: 'anthropic', modelName: 'auto' })
  })

  it('ignores a leading colon rather than reading an empty provider', () => {
    expect(parseAgentModel(':gpt-6.1-sol')).toEqual({ providerId: 'openai', modelName: ':gpt-6.1-sol' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseAgentModel('  anthropic:claude-opus-5-5  ')).toEqual({
      providerId: 'anthropic',
      modelName: 'claude-opus-5-5',
    })
  })
})

describe('getAgentApiKeyEnvVar', () => {
  it.each<[AgentProviderId, string]>([
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['openai-compatible', 'DEEPNOTE_AGENT_API_KEY'],
  ])('names the variable %s falls back to', (providerId, envVar) => {
    expect(getAgentApiKeyEnvVar(providerId)).toBe(envVar)
  })
})

describe('resolveAgentModel', () => {
  it('keeps the documented openai default and reasoning summaries', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: {} })

    expect(resolved.model).toMatchObject({ provider: 'openai.responses', modelId: 'gpt-6.1-sol' })
    expect(resolved.providerOptions).toEqual({ openai: { reasoningSummary: 'auto' } })
  })

  it('lets OPENAI_MODEL override the openai default', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.model).toMatchObject({ modelId: 'gpt-6-luna' })
  })

  it('prefers the block model over OPENAI_MODEL', () => {
    const resolved = resolveAgentModel({ spec: 'gpt-6.1-sol', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.model).toMatchObject({ modelId: 'gpt-6.1-sol' })
  })

  it.each([
    ['auto', undefined, 'https://api.openai.com/v1/responses'],
    ['llama4', 'http://localhost:11434/v1/', 'http://localhost:11434/v1/responses'],
  ])('sends %s with OPENAI_BASE_URL=%s to the Responses API', async (spec, baseURL, expectedUrl) => {
    const request = await captureRequest(resolveAgentModel({ spec, apiKey: 'k', env: { OPENAI_BASE_URL: baseURL } }))

    expect(request.url).toBe(expectedUrl)
    expect(request.body.tools).toEqual([expect.objectContaining({ name: 'noop' })])
  })

  it('resolves anthropic with a Claude default and summarized thinking', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: {} })

    expect(resolved.model).toMatchObject({ provider: 'anthropic.messages', modelId: 'claude-opus-5-5' })
    expect(resolved.providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' } },
    })
  })

  it.each([
    [undefined, 'https://api.anthropic.com/v1/messages'],
    ['https://gateway.example', 'https://gateway.example/v1/messages'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1/messages'],
  ])('accepts ANTHROPIC_BASE_URL=%s with or without /v1', async (baseURL, expectedUrl) => {
    const request = await captureRequest(
      resolveAgentModel({ spec: 'claude-opus-5-5', apiKey: 'k', env: { ANTHROPIC_BASE_URL: baseURL } })
    )

    expect(request.url).toBe(expectedUrl)
  })

  it('lets ANTHROPIC_MODEL override the anthropic default', () => {
    const resolved = resolveAgentModel({
      spec: 'anthropic:auto',
      apiKey: 'k',
      env: { ANTHROPIC_MODEL: 'claude-sonnet-5-5' },
    })

    expect(resolved.model).toMatchObject({ modelId: 'claude-sonnet-5-5' })
  })

  it.each(['claude-haiku-4-5', 'claude-opus-4-5', 'custom-deployment'])(
    'does not send adaptive thinking for %s',
    async modelName => {
      const request = await captureRequest(resolveAgentModel({ spec: `anthropic:${modelName}`, apiKey: 'k', env: {} }))

      expect(request.body.model).toBe(modelName)
      expect(request.body).not.toHaveProperty('thinking')
    }
  )

  it('does not let OPENAI_MODEL leak into another provider', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.model).toMatchObject({ modelId: 'claude-opus-5-5' })
  })

  it('reads the API key from the provider variable when none is passed', async () => {
    const request = await captureRequest(
      resolveAgentModel({ spec: 'claude-opus-5-5', env: { ANTHROPIC_API_KEY: 'anthropic-key' } })
    )

    expect(request.headers['x-api-key']).toBe('anthropic-key')
  })

  it.each([
    ['claude-opus-5-5', 'ANTHROPIC_API_KEY'],
    ['openai-compatible:llama4', 'DEEPNOTE_AGENT_API_KEY'],
  ])('does not use OPENAI_* credentials for %s', (spec, keyVar) => {
    expect(() =>
      resolveAgentModel({
        spec,
        env: { OPENAI_API_KEY: 'openai-key', OPENAI_BASE_URL: 'http://localhost:11434/v1' },
      })
    ).toThrow(`Set ${keyVar} to run this agent block.`)
  })

  it('resolves openai-compatible from its own variables', () => {
    const resolved = resolveAgentModel({
      spec: 'openai-compatible:auto',
      apiKey: 'k',
      env: {
        DEEPNOTE_AGENT_BASE_URL: 'https://openrouter.ai/api/v1',
        DEEPNOTE_AGENT_MODEL: 'anthropic/claude-opus-5.5',
      },
    })

    expect(resolved.model).toMatchObject({ modelId: 'anthropic/claude-opus-5.5' })
    expect(resolved.providerOptions).toEqual({})
  })

  it('names the variable to set when openai-compatible has no endpoint', () => {
    expect(() =>
      resolveAgentModel({
        spec: 'openai-compatible:llama4',
        apiKey: 'k',
        env: { OPENAI_BASE_URL: 'http://localhost:11434/v1' },
      })
    ).toThrow(/DEEPNOTE_AGENT_BASE_URL/)
  })

  it('refuses to guess a model for openai-compatible', () => {
    expect(() =>
      resolveAgentModel({
        spec: 'openai-compatible:auto',
        apiKey: 'k',
        env: { DEEPNOTE_AGENT_BASE_URL: 'https://example.test/v1' },
      })
    ).toThrow(/DEEPNOTE_AGENT_MODEL/)
  })

  it('ignores empty env values instead of treating them as configured', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: { OPENAI_MODEL: '' } })

    expect(resolved.model).toMatchObject({ modelId: 'gpt-6.1-sol' })
  })

  it('ignores an empty OPENAI_BASE_URL', () => {
    vi.stubEnv('OPENAI_BASE_URL', '')

    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k' })

    expect(resolved.model).toMatchObject({ provider: 'openai.responses', modelId: 'gpt-6.1-sol' })
  })
})
