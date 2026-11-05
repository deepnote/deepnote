import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { JSONValue, LanguageModel } from 'ai'

/**
 * Providers a local agent block can run against. Bare Claude model ids select
 * Anthropic, matching Cloud. Provider prefixes are a local runtime extension.
 */
export const AGENT_PROVIDER_IDS = ['openai', 'anthropic', 'openai-compatible'] as const

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

/** Model name meaning "whatever the provider defaults to". */
const AGENT_MODEL_AUTO = 'auto'

// Only force adaptive thinking for models whose support we have verified.
// Other Claude models (including older models and custom deployment ids) use
// their API defaults instead of receiving potentially unsupported options.
const SUMMARIZED_ADAPTIVE_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])

/** `ai` keeps its own `ProviderOptions` internal, so mirror the shape the agent accepts. */
export type AgentProviderOptions = Record<string, Record<string, JSONValue>>

export interface ParsedAgentModel {
  providerId: AgentProviderId
  /** `'auto'` when the block defers to the provider default. */
  modelName: string
}

export interface ResolveAgentModelOptions {
  /** Raw `deepnote_agent_model` value. */
  spec: string | undefined
  /** API key for the resolved provider. Read from the provider's env var when omitted. */
  apiKey?: string
  /** Defaults to `process.env`; injected in tests. */
  env?: Record<string, string | undefined>
}

export interface ResolvedAgentModel {
  model: LanguageModel
  providerOptions: AgentProviderOptions
}

interface ProviderEnvConfig {
  /** Env var holding the API key. Named in the error when the key is missing. */
  apiKeyVar: string
  /** Env var overriding the endpoint. */
  baseUrlVar: string
  /** Env var supplying the model when the block says `'auto'`. */
  modelVar: string
  /** Model used when neither the block nor `modelVar` names one. */
  defaultModel: string
}

const PROVIDER_ENV: Record<AgentProviderId, ProviderEnvConfig> = {
  openai: {
    apiKeyVar: 'OPENAI_API_KEY',
    baseUrlVar: 'OPENAI_BASE_URL',
    modelVar: 'OPENAI_MODEL',
    defaultModel: 'gpt-6.1-sol',
  },
  anthropic: {
    apiKeyVar: 'ANTHROPIC_API_KEY',
    baseUrlVar: 'ANTHROPIC_BASE_URL',
    modelVar: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-opus-5-5',
  },
  'openai-compatible': {
    apiKeyVar: 'DEEPNOTE_AGENT_API_KEY',
    baseUrlVar: 'DEEPNOTE_AGENT_BASE_URL',
    modelVar: 'DEEPNOTE_AGENT_MODEL',
    // Deliberately absent: an OpenAI-compatible endpoint is only reachable once
    // the caller names a model, so `'auto'` without `DEEPNOTE_AGENT_MODEL` is an
    // error rather than a guess at someone else's catalogue.
    defaultModel: '',
  },
}

// Passed explicitly because the SDKs otherwise re-read their base URL from
// `process.env`, bypassing the injected `env` and rejecting empty values.
const OPENAI_API_URL = 'https://api.openai.com/v1'
const ANTHROPIC_API_URL = 'https://api.anthropic.com'

function isAgentProviderId(value: string): value is AgentProviderId {
  return (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Splits `deepnote_agent_model` into a provider and a model name.
 *
 * Only a known provider id counts as a prefix. Anything else is treated as a
 * whole model name. Bare Claude ids select Anthropic; other bare names retain
 * the OpenAI route. Slash-separated aggregator ids are left intact.
 */
export function parseAgentModel(spec: string | undefined): ParsedAgentModel {
  const trimmed = spec?.trim()
  if (!trimmed || trimmed === 'default') {
    return { providerId: 'openai', modelName: AGENT_MODEL_AUTO }
  }

  const separatorIndex = trimmed.indexOf(':')
  if (separatorIndex > 0) {
    const candidate = trimmed.slice(0, separatorIndex)
    if (isAgentProviderId(candidate)) {
      const modelName = trimmed.slice(separatorIndex + 1).trim()
      return { providerId: candidate, modelName: !modelName || modelName === 'default' ? AGENT_MODEL_AUTO : modelName }
    }
  }

  return { providerId: trimmed.startsWith('claude-') ? 'anthropic' : 'openai', modelName: trimmed }
}

/**
 * Returns the name of the environment variable `resolveAgentModel` reads the
 * provider's API key from when no `apiKey` is passed.
 */
export function getAgentApiKeyEnvVar(providerId: AgentProviderId): string {
  return PROVIDER_ENV[providerId].apiKeyVar
}

function readEnv(
  env: Record<string, string | undefined>,
  providerId: AgentProviderId,
  key: keyof Omit<ProviderEnvConfig, 'defaultModel'>
): string | undefined {
  const value = env[PROVIDER_ENV[providerId][key]]
  return value === '' ? undefined : value
}

/**
 * `ANTHROPIC_BASE_URL` omits `/v1` in Anthropic's SDK and Claude Code, while
 * the AI SDK expects it included. Accept both forms.
 */
function anthropicApiUrl(baseURL: string | undefined): string {
  return `${(baseURL ?? ANTHROPIC_API_URL).replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`
}

/**
 * Builds the language model and provider-specific options for an agent block.
 *
 * @throws Error when the provider cannot be configured from the environment.
 */
export function resolveAgentModel({ spec, apiKey, env = process.env }: ResolveAgentModelOptions): ResolvedAgentModel {
  const { providerId, modelName: requestedModel } = parseAgentModel(spec)
  const config = PROVIDER_ENV[providerId]

  const key = apiKey ?? readEnv(env, providerId, 'apiKeyVar')
  if (!key) {
    throw new Error(`Set ${config.apiKeyVar} to run this agent block.`)
  }

  const modelName =
    requestedModel === AGENT_MODEL_AUTO ? (readEnv(env, providerId, 'modelVar') ?? config.defaultModel) : requestedModel
  if (modelName === '') {
    throw new Error(`Set the block's deepnote_agent_model or ${config.modelVar} to choose a model for "${providerId}".`)
  }

  const baseURL = readEnv(env, providerId, 'baseUrlVar')
  switch (providerId) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: key, baseURL: anthropicApiUrl(baseURL) })
      return {
        model: anthropic(modelName),
        providerOptions: SUMMARIZED_ADAPTIVE_MODELS.has(modelName)
          ? { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } }
          : {},
      }
    }
    case 'openai-compatible': {
      if (baseURL == null) {
        throw new Error(`Set ${config.baseUrlVar} to your provider's base URL, e.g. https://openrouter.ai/api/v1.`)
      }
      const provider = createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey: key })
      return { model: provider(modelName), providerOptions: {} }
    }
    default: {
      // Always the Responses API; endpoints with only Chat Completions use `openai-compatible`.
      const openai = createOpenAI({ apiKey: key, baseURL: baseURL ?? OPENAI_API_URL })
      return { model: openai(modelName), providerOptions: { openai: { reasoningSummary: 'auto' } } }
    }
  }
}
