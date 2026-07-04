import { describe, it, expect } from 'vitest'
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  isAiProvider,
  defaultModelFor,
  resolveChatEndpoint,
} from './registry'

describe('provider registry', () => {
  it('every provider has coherent metadata', () => {
    for (const id of AI_PROVIDER_IDS) {
      const m = AI_PROVIDERS[id]
      expect(m.id).toBe(id)
      expect(m.label.length).toBeGreaterThan(0)
      // openai-family hosted providers must ship a fixed endpoint; the
      // ones that require a base URL (azure/custom) may omit it.
      if (m.family === 'openai' && !m.requiresBaseUrl) {
        expect(m.endpoint).toMatch(/^https?:\/\/.+\/chat\/completions$/)
      }
    }
  })

  it('isAiProvider guards unknown values', () => {
    expect(isAiProvider('openai')).toBe(true)
    expect(isAiProvider('gemini')).toBe(true)
    expect(isAiProvider('openai_compatible')).toBe(true)
    expect(isAiProvider('nope')).toBe(false)
    expect(isAiProvider(null)).toBe(false)
  })

  it('defaultModelFor returns the registry default', () => {
    expect(defaultModelFor('openai')).toBe('gpt-5.4-mini')
    expect(defaultModelFor('openai_compatible')).toBe('')
  })

  describe('resolveChatEndpoint', () => {
    it('uses the fixed endpoint for hosted providers', () => {
      const r = resolveChatEndpoint('openrouter', null)
      expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(r.authStyle).toBe('bearer')
    })

    it('OpenAI keeps the max_completion_tokens param; others use max_tokens', () => {
      expect(resolveChatEndpoint('openai', null).maxTokensParam).toBe('max_completion_tokens')
      expect(resolveChatEndpoint('groq', null).maxTokensParam).toBe('max_tokens')
    })

    it('appends /chat/completions to a custom /v1 base (local servers)', () => {
      const r = resolveChatEndpoint('openai_compatible', 'http://localhost:11434/v1')
      expect(r.url).toBe('http://localhost:11434/v1/chat/completions')
    })

    it('leaves an already-complete completions URL untouched (Azure)', () => {
      const azure =
        'https://res.openai.azure.com/openai/deployments/dep/chat/completions?api-version=2024-08-01-preview'
      const r = resolveChatEndpoint('azure', azure)
      expect(r.url).toBe(azure)
      expect(r.authStyle).toBe('azure')
    })

    it('trims a trailing slash on the base URL', () => {
      const r = resolveChatEndpoint('openai_compatible', 'http://localhost:1234/v1/')
      expect(r.url).toBe('http://localhost:1234/v1/chat/completions')
    })

    it('lets a base URL override a hosted provider (proxy)', () => {
      const r = resolveChatEndpoint('openai', 'https://proxy.internal/v1')
      expect(r.url).toBe('https://proxy.internal/v1/chat/completions')
    })
  })
})
