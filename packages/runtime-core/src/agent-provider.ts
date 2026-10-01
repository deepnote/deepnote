import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { JSONValue, LanguageModel } from 'ai'

/**
 * Providers an agent block can run against. The id is the optional prefix of
 * `deepnote_agent_model` (`anthropic:claude-opus-5`); a bare model name means
 * `openai`, so files written before prefixes existed keep working.
 */
export const AGENT_PROVIDER_IDS = ['openai', 'anthropic', 'openai-compatible'] as const

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

/** Model name meaning "whatever the provider defaults to". */
export const AGENT_MODEL_AUTO = 'auto'

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
  /** API key for the resolved provider. */
  apiKey: string
  /** Defaults to `process.env`; injected in tests. */
  env?: Record<string, string | undefined>
}

export interface ResolvedAgentModel {
  model: LanguageModel
  providerOptions: AgentProviderOptions
  providerId: AgentProviderId
  /** Concrete model name after `'auto'` resolution. */
  modelName: string
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
    defaultModel: 'gpt-5',
  },
  anthropic: {
    apiKeyVar: 'ANTHROPIC_API_KEY',
    baseUrlVar: 'ANTHROPIC_BASE_URL',
    modelVar: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-opus-5',
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

/**
 * `openai-compatible` falls back to the `OPENAI_*` variables so the existing
 * "point `OPENAI_BASE_URL` at Ollama" setups keep working after they switch to
 * the explicit provider id.
 */
const OPENAI_COMPATIBLE_FALLBACK_VARS: Record<keyof Omit<ProviderEnvConfig, 'defaultModel'>, string> = {
  apiKeyVar: 'OPENAI_API_KEY',
  baseUrlVar: 'OPENAI_BASE_URL',
  modelVar: 'OPENAI_MODEL',
}

function isAgentProviderId(value: string): value is AgentProviderId {
  return (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Splits `deepnote_agent_model` into a provider and a model name.
 *
 * Only a known provider id counts as a prefix. Anything else is treated as a
 * whole model name on `openai`, which keeps unprefixed values such as
 * `gpt-5.6-sol` working and leaves slash-separated aggregator ids
 * (`anthropic/claude-opus-5`) intact.
 */
export function parseAgentModel(spec: string | undefined): ParsedAgentModel {
  const trimmed = spec?.trim()
  if (!trimmed) {
    return { providerId: 'openai', modelName: AGENT_MODEL_AUTO }
  }

  const separatorIndex = trimmed.indexOf(':')
  if (separatorIndex > 0) {
    const candidate = trimmed.slice(0, separatorIndex)
    if (isAgentProviderId(candidate)) {
      const modelName = trimmed.slice(separatorIndex + 1).trim()
      return { providerId: candidate, modelName: modelName === '' ? AGENT_MODEL_AUTO : modelName }
    }
  }

  return { providerId: 'openai', modelName: trimmed }
}

/** Env var that must hold the API key for `providerId`. Used in error messages. */
export function apiKeyEnvVarFor(providerId: AgentProviderId): string {
  return PROVIDER_ENV[providerId].apiKeyVar
}

function readEnv(
  env: Record<string, string | undefined>,
  providerId: AgentProviderId,
  key: keyof Omit<ProviderEnvConfig, 'defaultModel'>
): string | undefined {
  const value = env[PROVIDER_ENV[providerId][key]]
  if (value != null && value !== '') {
    return value
  }
  if (providerId === 'openai-compatible') {
    const fallback = env[OPENAI_COMPATIBLE_FALLBACK_VARS[key]]
    return fallback === '' ? undefined : fallback
  }
  return undefined
}

/**
 * Builds the language model and provider-specific options for an agent block.
 *
 * @throws Error when the provider cannot be configured from the environment.
 */
export function resolveAgentModel({ spec, apiKey, env = process.env }: ResolveAgentModelOptions): ResolvedAgentModel {
  const { providerId, modelName: requestedModel } = parseAgentModel(spec)
  const baseURL = readEnv(env, providerId, 'baseUrlVar')

  const modelName =
    requestedModel === AGENT_MODEL_AUTO
      ? (readEnv(env, providerId, 'modelVar') ?? PROVIDER_ENV[providerId].defaultModel)
      : requestedModel

  if (modelName === '') {
    throw new Error(
      `No model configured for the "${providerId}" agent provider.\n` +
        `Set the block's model explicitly, or set ${PROVIDER_ENV[providerId].modelVar}.`
    )
  }

  switch (providerId) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, baseURL })
      return {
        model: anthropic(modelName),
        // `summarized` so reasoning reaches `onAgentEvent` as it does on OpenAI;
        // the Anthropic default omits it and the UI would show a silent pause.
        providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } },
        providerId,
        modelName,
      }
    }
    case 'openai-compatible': {
      if (baseURL == null) {
        throw new Error(
          'The "openai-compatible" agent provider needs an endpoint.\n' +
            `Set ${PROVIDER_ENV[providerId].baseUrlVar} to the provider's base URL (for example https://openrouter.ai/api/v1).`
        )
      }
      const provider = createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey })
      return { model: provider(modelName), providerOptions: {}, providerId, modelName }
    }
    default: {
      const openai = createOpenAI({ apiKey, baseURL })
      // Use the Responses API for direct OpenAI access (supports reasoning
      // summaries), but fall back to Chat Completions for custom base URLs
      // since most OpenAI-compatible providers don't implement the Responses API.
      const model = baseURL ? openai.chat(modelName) : openai(modelName)
      return {
        model,
        providerOptions: baseURL ? {} : { openai: { reasoningSummary: 'auto' } },
        providerId,
        modelName,
      }
    }
  }
}
