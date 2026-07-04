import type { AiProvider } from '../types'

// ============================================================
// Provider registry — one place that knows every supported AI provider,
// its default model, endpoint, and auth style. Everything downstream
// (dispatch, config validation, the settings UI) reads from this, so
// adding a provider is a one-entry change here.
//
// Under the hood there are only TWO request shapes:
//   - 'anthropic'  → the Anthropic Messages API.
//   - 'openai'     → the OpenAI Chat Completions API, which almost every
//                    other provider and EVERY self-hosted server speaks.
// So the long list below is mostly OpenAI-family entries that differ only
// in endpoint URL / default model, plus `openai_compatible` for "point it
// at any base URL" (Ollama, LM Studio, LocalAI, vLLM, a proxy, …).
// ============================================================

export type ProviderFamily = 'openai' | 'anthropic'
export type AuthStyle = 'bearer' | 'anthropic' | 'azure'

export interface ProviderMeta {
  id: AiProvider
  label: string
  family: ProviderFamily
  authStyle: AuthStyle
  /** Pre-filled default model in the settings form (editable free text). */
  defaultModel: string
  /** Fixed chat-completions URL for hosted providers. */
  endpoint?: string
  /** The user MUST supply a base URL (Azure / self-hosted). */
  requiresBaseUrl?: boolean
  /** The API key may be blank (keyless local servers). */
  keyOptional?: boolean
  /** OpenAI split newer models on `max_completion_tokens`; the rest of the
   *  ecosystem (and local servers) use `max_tokens`. */
  maxTokensParam: 'max_completion_tokens' | 'max_tokens'
  keyPlaceholder: string
  /** Help text shown under the provider / base-url field. */
  hint?: string
}

export const AI_PROVIDERS: Record<AiProvider, ProviderMeta> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'gpt-5.4-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    maxTokensParam: 'max_completion_tokens',
    keyPlaceholder: 'sk-...',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    family: 'anthropic',
    authStyle: 'anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'sk-ant-...',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'gemini-2.0-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'AIza...',
    hint: 'Uses Gemini’s OpenAI-compatible endpoint. Get a key at Google AI Studio.',
  },
  azure: {
    id: 'azure',
    label: 'Azure OpenAI',
    family: 'openai',
    authStyle: 'azure',
    requiresBaseUrl: true,
    defaultModel: 'gpt-4o-mini',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'your Azure API key',
    hint:
      'Endpoint = the full completions URL incl. deployment + api-version, e.g. ' +
      'https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-08-01-preview',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'openai/gpt-4o-mini',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'sk-or-...',
    hint: 'One key, hundreds of models. Set the model to any OpenRouter model id.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'gsk_...',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'sk-...',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'mistral-small-latest',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: '...',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: '...',
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'grok-2-latest',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: 'xai-...',
  },
  glm: {
    id: 'glm',
    label: 'Zhipu GLM',
    family: 'openai',
    authStyle: 'bearer',
    defaultModel: 'glm-4-flash',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: '...',
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Custom / Self-hosted (OpenAI-compatible)',
    family: 'openai',
    authStyle: 'bearer',
    requiresBaseUrl: true,
    keyOptional: true,
    defaultModel: '',
    maxTokensParam: 'max_tokens',
    keyPlaceholder: '(blank if your server needs no key)',
    hint:
      'Any OpenAI-compatible server — Ollama, LM Studio, LocalAI, vLLM, or a proxy. ' +
      'Base URL usually ends in /v1, e.g. http://localhost:11434/v1. It must be reachable ' +
      'from where the app runs.',
  },
}

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProvider[]

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AI_PROVIDERS, v)
}

export function providerMeta(p: AiProvider): ProviderMeta {
  return AI_PROVIDERS[p]
}

export function defaultModelFor(p: AiProvider): string {
  return AI_PROVIDERS[p]?.defaultModel ?? ''
}

/**
 * Resolve the chat-completions URL + auth style for an OpenAI-family
 * provider, given the account's optional base URL. (Anthropic doesn't use
 * this — it has its own adapter.)
 *
 * - Hosted providers: their fixed endpoint, or a base-URL override if set.
 * - Azure: the user pastes the full completions URL (incl. api-version) —
 *   used as-is.
 * - Custom: base usually ends at `/v1`; we append `/chat/completions`
 *   unless it's already a completions URL.
 */
export function resolveChatEndpoint(
  provider: AiProvider,
  baseUrl: string | null,
): { url: string; authStyle: AuthStyle; maxTokensParam: ProviderMeta['maxTokensParam'] } {
  const meta = AI_PROVIDERS[provider]
  const authStyle = meta?.authStyle ?? 'bearer'
  const maxTokensParam = meta?.maxTokensParam ?? 'max_tokens'
  const bu = (baseUrl ?? '').trim().replace(/\/+$/, '')

  const asCompletions = (base: string): string =>
    /\/chat\/completions(\?|$)/.test(base) ? base : `${base}/chat/completions`

  if (meta?.requiresBaseUrl) {
    // Azure users paste the whole URL; custom users give the /v1 base.
    return { url: bu ? asCompletions(bu) : (meta.endpoint ?? ''), authStyle, maxTokensParam }
  }

  // Hosted provider — allow a base-URL override (e.g. a proxy), else fixed.
  return { url: bu ? asCompletions(bu) : (meta?.endpoint ?? ''), authStyle, maxTokensParam }
}
