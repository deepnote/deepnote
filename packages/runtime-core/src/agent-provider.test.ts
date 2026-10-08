import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiKeyEnvVarFor, parseAgentModel, resolveAgentApiKey, resolveAgentModel } from './agent-provider'

afterEach(() => vi.unstubAllGlobals())

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

describe('resolveAgentApiKey', () => {
  it.each([undefined, ''])('falls back to OPENAI_API_KEY when the compatible key is %s', key => {
    expect(resolveAgentApiKey('openai-compatible', { DEEPNOTE_AGENT_API_KEY: key, OPENAI_API_KEY: 'fallback' })).toBe(
      'fallback'
    )
  })

  it('prefers the compatible provider key over the fallback', () => {
    expect(
      resolveAgentApiKey('openai-compatible', { DEEPNOTE_AGENT_API_KEY: 'primary', OPENAI_API_KEY: 'fallback' })
    ).toBe('primary')
  })

  it('does not use another provider’s credentials for Anthropic', () => {
    expect(() => resolveAgentApiKey('anthropic', { OPENAI_API_KEY: 'openai-key' })).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('names both accepted variables when the compatible key is missing', () => {
    expect(() => resolveAgentApiKey('openai-compatible', {})).toThrow(/DEEPNOTE_AGENT_API_KEY \(or OPENAI_API_KEY\)/)
  })
})

describe('apiKeyEnvVarFor', () => {
  it('names the variable each provider reads', () => {
    expect(apiKeyEnvVarFor('openai')).toBe('OPENAI_API_KEY')
    expect(apiKeyEnvVarFor('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(apiKeyEnvVarFor('openai-compatible')).toBe('DEEPNOTE_AGENT_API_KEY')
  })
})

describe('resolveAgentModel', () => {
  it('keeps the documented openai default and reasoning summaries', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: {} })

    expect(resolved.providerId).toBe('openai')
    expect(resolved.modelName).toBe('gpt-6.1-sol')
    // GPT-6.1 Sol requires Responses for tool calls.
    expect(resolved.model).toMatchObject({ provider: 'openai.responses', modelId: 'gpt-6.1-sol' })
    expect(resolved.providerOptions).toEqual({ openai: { reasoningSummary: 'auto' } })
  })

  it('lets OPENAI_MODEL override the openai default', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.modelName).toBe('gpt-6-luna')
  })

  it('prefers the block model over OPENAI_MODEL', () => {
    const resolved = resolveAgentModel({ spec: 'gpt-6.1-sol', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.modelName).toBe('gpt-6.1-sol')
  })

  it('drops reasoning summaries when OPENAI_BASE_URL points elsewhere', () => {
    // Most OpenAI-compatible endpoints have no Responses API, so the handler
    // falls back to Chat Completions and the option would be rejected.
    const resolved = resolveAgentModel({
      spec: 'auto',
      apiKey: 'k',
      env: { OPENAI_BASE_URL: 'https://example.test/v1', OPENAI_MODEL: 'custom-chat-model' },
    })

    expect(resolved.providerOptions).toEqual({})
    expect(resolved.model).toMatchObject({ provider: 'openai.chat', modelId: 'custom-chat-model' })
  })

  it.each(['https://api.openai.com/v1', 'https://api.openai.com/v1/', 'https://proxy.example/v1'])(
    'sends default-model tools to Responses with OPENAI_BASE_URL=%s',
    async baseURL => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Network disabled in test'))
      vi.stubGlobal('fetch', fetch)
      const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: { OPENAI_BASE_URL: baseURL } })
      if (typeof resolved.model === 'string' || resolved.model.specificationVersion !== 'v4') {
        throw new Error('Expected a v4 provider')
      }
      await expect(
        resolved.model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Use the tool' }] }],
          tools: [{ type: 'function', name: 'noop', inputSchema: { type: 'object', properties: {} } }],
          providerOptions: resolved.providerOptions,
        })
      ).rejects.toThrow('Network disabled in test')
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0]?.[0]).toBe(`${baseURL.replace(/\/+$/, '')}/responses`)
      const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
      expect(body.model).toBe('gpt-6.1-sol')
      expect(body.tools).toEqual([expect.objectContaining({ name: 'noop' })])
    }
  )

  it.each(['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'])('keeps %s on Responses through a proxy', modelName => {
    const resolved = resolveAgentModel({
      spec: modelName,
      apiKey: 'k',
      env: { OPENAI_BASE_URL: 'https://proxy.example/v1' },
    })
    expect(resolved.model).toMatchObject({ provider: 'openai.responses', modelId: modelName })
  })

  it('resolves anthropic with a Claude default and summarized thinking', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: {} })

    expect(resolved.providerId).toBe('anthropic')
    expect(resolved.modelName).toBe('claude-opus-5-5')
    expect(resolved.model).toMatchObject({ provider: 'anthropic.messages', modelId: 'claude-opus-5-5' })
    expect(resolved.providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' } },
    })
  })

  it('lets ANTHROPIC_MODEL override the anthropic default', () => {
    const resolved = resolveAgentModel({
      spec: 'anthropic:auto',
      apiKey: 'k',
      env: { ANTHROPIC_MODEL: 'claude-sonnet-5-5' },
    })

    expect(resolved.modelName).toBe('claude-sonnet-5-5')
  })

  it.each(['claude-haiku-4-5', 'claude-opus-4-5', 'custom-deployment'])(
    'does not send adaptive thinking for %s',
    async modelName => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Network disabled in test'))
      vi.stubGlobal('fetch', fetch)
      const resolved = resolveAgentModel({ spec: `anthropic:${modelName}`, apiKey: 'k', env: {} })
      if (typeof resolved.model === 'string' || resolved.model.specificationVersion !== 'v4') {
        throw new Error('Expected a v4 provider')
      }
      await expect(
        resolved.model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          providerOptions: resolved.providerOptions,
        })
      ).rejects.toThrow('Network disabled in test')
      expect(fetch).toHaveBeenCalledOnce()
      const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
      expect(body.model).toBe(modelName)
      expect(body).not.toHaveProperty('thinking')
    }
  )

  it('does not let OPENAI_MODEL leak into another provider', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-6-luna' } })

    expect(resolved.modelName).toBe('claude-opus-5-5')
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

    expect(resolved.modelName).toBe('anthropic/claude-opus-5.5')
    expect(resolved.providerOptions).toEqual({})
  })

  it('falls back to the OPENAI_* variables for openai-compatible', () => {
    const resolved = resolveAgentModel({
      spec: 'openai-compatible:auto',
      apiKey: 'k',
      env: { OPENAI_BASE_URL: 'http://localhost:11434/v1', OPENAI_MODEL: 'llama4' },
    })

    expect(resolved.modelName).toBe('llama4')
  })

  it('names the variable to set when openai-compatible has no endpoint', () => {
    expect(() => resolveAgentModel({ spec: 'openai-compatible:llama4', apiKey: 'k', env: {} })).toThrow(
      /DEEPNOTE_AGENT_BASE_URL/
    )
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

    expect(resolved.modelName).toBe('gpt-6.1-sol')
  })
})
