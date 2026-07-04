// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

// Supported AI providers. Two request "families" under the hood (see
// providers/registry.ts): the Anthropic Messages API, and the OpenAI Chat
// Completions API — which almost every provider AND every self-hosted
// server (Ollama, LM Studio, LocalAI, vLLM…) speaks, so `openai_compatible`
// + a base URL covers "any provider".
export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'azure'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'xai'
  | 'glm'
  | 'openai_compatible'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  /** Custom endpoint base URL — required for `azure` and
   *  `openai_compatible` (self-hosted/local); an optional proxy override
   *  for the hosted providers. Null when the provider's default is used. */
  baseUrl: string | null
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
