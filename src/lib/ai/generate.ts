import { AiError, type AiConfig, type ChatMessage, type GenerateResult } from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAiCompatible } from './providers/openai-compatible'
import { generateAnthropic } from './providers/anthropic'
import { AI_PROVIDERS, resolveChatEndpoint } from './providers/registry'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
/**
 * Raw completion from the account's configured provider — no handoff
 * parsing. Used by non-reply tools (e.g. the conversation summarizer)
 * that want the model's text verbatim. Throws `AiError` on failure.
 */
export async function generateRaw(args: GenerateArgs): Promise<string> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  const meta = AI_PROVIDERS[config.provider]
  if (!meta) {
    throw new AiError(`Unsupported AI provider: ${config.provider}`, {
      code: 'unsupported_provider',
      status: 400,
    })
  }

  // Anthropic has its own request shape; everything else speaks the OpenAI
  // Chat Completions API via the shared compatible adapter, differing only
  // in endpoint URL + auth style (resolved from the registry + base URL).
  if (meta.family === 'anthropic') {
    return generateAnthropic(providerArgs)
  }

  const { url, authStyle, maxTokensParam } = resolveChatEndpoint(
    config.provider,
    config.baseUrl,
  )
  return generateOpenAiCompatible({
    ...providerArgs,
    url,
    authStyle: authStyle === 'anthropic' ? 'bearer' : authStyle,
    maxTokensParam,
    providerLabel: meta.label,
  })
}

export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  return parseGeneration(await generateRaw(args))
}

/**
 * Split the raw model output into `{ text, handoff }`. The sentinel can
 * appear alone or trailing a partial reply; either way we treat the
 * turn as a handoff and strip the marker from any remaining text.
 */
export function parseGeneration(raw: string): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}
