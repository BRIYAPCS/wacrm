import { AiError } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import type { AuthStyle, ProviderMeta } from './registry'

// ============================================================
// OpenAI Chat Completions adapter — parameterised by endpoint URL + auth
// style, so ONE code path serves OpenAI, Gemini (its OpenAI endpoint),
// Azure, OpenRouter, Groq, DeepSeek, Mistral, Together, xAI, GLM, and any
// self-hosted OpenAI-compatible server (Ollama / LM Studio / LocalAI /
// vLLM). The request/response shape is identical across all of them.
// ============================================================

export interface CompatibleArgs extends ProviderArgs {
  /** Full chat-completions URL (from resolveChatEndpoint). */
  url: string
  /** 'bearer' (Authorization) or 'azure' (api-key header). */
  authStyle: Exclude<AuthStyle, 'anthropic'>
  /** OpenAI newer models need `max_completion_tokens`; others use `max_tokens`. */
  maxTokensParam: ProviderMeta['maxTokensParam']
  /** Human label for error messages (e.g. "OpenRouter"). */
  providerLabel: string
}

interface CompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export async function generateOpenAiCompatible(args: CompatibleArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, url, authStyle, maxTokensParam, providerLabel } = args

  if (!url) {
    throw new AiError(`${providerLabel}: no endpoint URL configured.`, {
      code: 'config_error',
      status: 400,
    })
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Keyless local servers: send no auth header when the key is blank.
  if (apiKey) {
    if (authStyle === 'azure') headers['api-key'] = apiKey
    else headers['Authorization'] = `Bearer ${apiKey}`
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...mergeConsecutive(messages),
    ],
    [maxTokensParam]: MAX_OUTPUT_TOKENS,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(providerLabel, res)
  }

  const data = (await res.json().catch(() => null)) as CompletionResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${providerLabel} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  return text
}
