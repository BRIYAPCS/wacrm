-- ============================================================
-- 046_ai_providers.sql — many AI providers + custom endpoints
--
-- The AI assistant was OpenAI/Anthropic only. This opens it to any
-- provider: Gemini, Azure OpenAI, OpenRouter, Groq, DeepSeek, Mistral,
-- Together, xAI, Zhipu GLM, and any self-hosted / OpenAI-compatible server
-- (Ollama, LM Studio, LocalAI, vLLM) via a base URL.
--
--   - `base_url` — optional custom endpoint (required for Azure + custom).
--   - Drop the two-value provider CHECK; the app validates the provider
--     against its registry (src/lib/ai/providers/registry.ts) instead, so
--     new providers don't need a migration.
--
-- Idempotent.
-- ============================================================

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS base_url text;

-- The old CHECK allowed only ('openai','anthropic'). Providers are now
-- an open, app-validated set (incl. custom endpoints), so drop it.
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
