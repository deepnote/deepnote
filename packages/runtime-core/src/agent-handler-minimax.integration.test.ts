/**
 * Integration tests for MiniMax provider support in agent-handler.
 *
 * These tests verify that the MiniMax provider can be configured and
 * that resolveAgentProvider returns valid model objects with correct
 * provider settings. They do NOT make actual API calls.
 *
 * To run a live smoke test, set MINIMAX_API_KEY in your environment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAgentProvider } from './agent-handler'

describe('MiniMax provider integration', () => {
  let savedOpenaiKey: string | undefined
  let savedMinimaxKey: string | undefined
  let savedMinimaxBaseUrl: string | undefined
  let savedMinimaxModel: string | undefined

  beforeEach(() => {
    savedOpenaiKey = process.env.OPENAI_API_KEY
    savedMinimaxKey = process.env.MINIMAX_API_KEY
    savedMinimaxBaseUrl = process.env.MINIMAX_BASE_URL
    savedMinimaxModel = process.env.MINIMAX_MODEL
    delete process.env.OPENAI_API_KEY
    delete process.env.MINIMAX_BASE_URL
    delete process.env.MINIMAX_MODEL
  })

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('OPENAI_API_KEY', savedOpenaiKey)
    restore('MINIMAX_API_KEY', savedMinimaxKey)
    restore('MINIMAX_BASE_URL', savedMinimaxBaseUrl)
    restore('MINIMAX_MODEL', savedMinimaxModel)
  })

  it('resolves MiniMax-M2.7 model with default settings', () => {
    process.env.MINIMAX_API_KEY = 'test-minimax-key'
    const result = resolveAgentProvider('auto')
    expect(result.providerName).toBe('minimax')
    expect(result.modelName).toBe('MiniMax-M2.7')
    expect(result.model).toBeDefined()
    expect(typeof result.model).toBe('object')
  })

  it('resolves MiniMax-M2.7-highspeed when configured via env', () => {
    process.env.MINIMAX_API_KEY = 'test-minimax-key'
    process.env.MINIMAX_MODEL = 'MiniMax-M2.7-highspeed'
    const result = resolveAgentProvider('auto')
    expect(result.modelName).toBe('MiniMax-M2.7-highspeed')
  })

  it('falls back from OpenAI to MiniMax gracefully', () => {
    // No OPENAI_API_KEY set, only MINIMAX_API_KEY
    process.env.MINIMAX_API_KEY = 'test-minimax-key'
    const result = resolveAgentProvider('auto')
    expect(result.providerName).toBe('minimax')
    expect(result.modelName).toBe('MiniMax-M2.7')
  })
})
