import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError } from '@/lib/ai/types'
import { isAiProvider, providerMeta } from '@/lib/ai/providers/registry'

/**
 * POST /api/ai/test  (admin+)
 *
 * "Test key" button: validate a candidate provider/model/key against
 * the provider WITHOUT saving. When `api_key` is omitted the stored
 * key is used, so an admin can re-test an existing config (e.g. after
 * changing the model). Returns `{ ok: true }` on success, 400 with the
 * provider's message on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const provider = body.provider
    if (!isAiProvider(provider)) {
      return NextResponse.json({ error: 'Unknown AI provider' }, { status: 400 })
    }
    const meta = providerMeta(provider)
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    let baseUrl: string | null = null
    if (typeof body.base_url === 'string' && body.base_url.trim()) {
      const bu = body.base_url.trim()
      try {
        new URL(bu)
      } catch {
        return NextResponse.json({ error: 'Endpoint URL must be a valid URL.' }, { status: 400 })
      }
      baseUrl = bu
    }
    if (meta.requiresBaseUrl && !baseUrl) {
      return NextResponse.json(
        { error: `${meta.label} needs an endpoint URL to test.` },
        { status: 400 },
      )
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (existing?.api_key) {
        try {
          apiKeyPlain = decrypt(existing.api_key)
        } catch {
          return NextResponse.json(
            { error: 'Stored API key could not be decrypted — re-enter your key.' },
            { status: 400 },
          )
        }
      } else if (!meta.keyOptional) {
        return NextResponse.json(
          { error: 'Enter an API key to test.' },
          { status: 400 },
        )
      }
      // keyOptional (keyless local) → apiKeyPlain stays '' and we test as-is.
    }

    try {
      await validateAiCredentials({
        provider,
        model,
        apiKey: apiKeyPlain,
        baseUrl,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        embeddingsApiKey: null,
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 400 },
        )
      }
      console.error('[ai/test] validation error:', err)
      return NextResponse.json(
        { error: 'Could not validate the API key.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
