import { describe, expect, it } from 'vitest'
import { apiKeyEnvVarFor, parseAgentModel, resolveAgentModel } from './agent-provider'

describe('parseAgentModel', () => {
  it('defaults to openai/auto when no model is set', () => {
    expect(parseAgentModel(undefined)).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('')).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('   ')).toEqual({ providerId: 'openai', modelName: 'auto' })
  })

  it('treats a bare model name as openai, so existing files keep working', () => {
    expect(parseAgentModel('auto')).toEqual({ providerId: 'openai', modelName: 'auto' })
    expect(parseAgentModel('gpt-5')).toEqual({ providerId: 'openai', modelName: 'gpt-5' })
    expect(parseAgentModel('gpt-5.6-sol')).toEqual({ providerId: 'openai', modelName: 'gpt-5.6-sol' })
  })

  it('splits a known provider prefix', () => {
    expect(parseAgentModel('anthropic:claude-opus-5')).toEqual({
      providerId: 'anthropic',
      modelName: 'claude-opus-5',
    })
    expect(parseAgentModel('openai:gpt-5')).toEqual({ providerId: 'openai', modelName: 'gpt-5' })
    expect(parseAgentModel('openai-compatible:llama3')).toEqual({
      providerId: 'openai-compatible',
      modelName: 'llama3',
    })
  })

  it('leaves slash-separated aggregator ids intact', () => {
    expect(parseAgentModel('openai-compatible:anthropic/claude-opus-5')).toEqual({
      providerId: 'openai-compatible',
      modelName: 'anthropic/claude-opus-5',
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
    expect(parseAgentModel(':gpt-5')).toEqual({ providerId: 'openai', modelName: ':gpt-5' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseAgentModel('  anthropic:claude-opus-5  ')).toEqual({
      providerId: 'anthropic',
      modelName: 'claude-opus-5',
    })
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
    expect(resolved.modelName).toBe('gpt-5')
    expect(resolved.providerOptions).toEqual({ openai: { reasoningSummary: 'auto' } })
  })

  it('lets OPENAI_MODEL override the openai default', () => {
    const resolved = resolveAgentModel({ spec: 'auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-4o' } })

    expect(resolved.modelName).toBe('gpt-4o')
  })

  it('prefers the block model over OPENAI_MODEL', () => {
    const resolved = resolveAgentModel({ spec: 'gpt-5', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-4o' } })

    expect(resolved.modelName).toBe('gpt-5')
  })

  it('drops reasoning summaries when OPENAI_BASE_URL points elsewhere', () => {
    // Most OpenAI-compatible endpoints have no Responses API, so the handler
    // falls back to Chat Completions and the option would be rejected.
    const resolved = resolveAgentModel({
      spec: 'auto',
      apiKey: 'k',
      env: { OPENAI_BASE_URL: 'https://example.test/v1' },
    })

    expect(resolved.providerOptions).toEqual({})
  })

  it('resolves anthropic with a Claude default and summarized thinking', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: {} })

    expect(resolved.providerId).toBe('anthropic')
    expect(resolved.modelName).toBe('claude-opus-5')
    expect(resolved.providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' } },
    })
  })

  it('lets ANTHROPIC_MODEL override the anthropic default', () => {
    const resolved = resolveAgentModel({
      spec: 'anthropic:auto',
      apiKey: 'k',
      env: { ANTHROPIC_MODEL: 'claude-sonnet-5' },
    })

    expect(resolved.modelName).toBe('claude-sonnet-5')
  })

  it('does not let OPENAI_MODEL leak into another provider', () => {
    const resolved = resolveAgentModel({ spec: 'anthropic:auto', apiKey: 'k', env: { OPENAI_MODEL: 'gpt-4o' } })

    expect(resolved.modelName).toBe('claude-opus-5')
  })

  it('resolves openai-compatible from its own variables', () => {
    const resolved = resolveAgentModel({
      spec: 'openai-compatible:auto',
      apiKey: 'k',
      env: { DEEPNOTE_AGENT_BASE_URL: 'https://openrouter.ai/api/v1', DEEPNOTE_AGENT_MODEL: 'anthropic/claude-opus-5' },
    })

    expect(resolved.modelName).toBe('anthropic/claude-opus-5')
    expect(resolved.providerOptions).toEqual({})
  })

  it('falls back to the OPENAI_* variables for openai-compatible', () => {
    const resolved = resolveAgentModel({
      spec: 'openai-compatible:auto',
      apiKey: 'k',
      env: { OPENAI_BASE_URL: 'http://localhost:11434/v1', OPENAI_MODEL: 'llama3' },
    })

    expect(resolved.modelName).toBe('llama3')
  })

  it('names the variable to set when openai-compatible has no endpoint', () => {
    expect(() => resolveAgentModel({ spec: 'openai-compatible:llama3', apiKey: 'k', env: {} })).toThrow(
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

    expect(resolved.modelName).toBe('gpt-5')
  })
})
