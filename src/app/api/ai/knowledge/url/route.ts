// ============================================================
// POST /api/ai/knowledge/url  (admin+)
//
// Body: { url, title? } — fetch a web page (or a linked PDF/text),
// extract its readable text, and add it to the knowledge base. The fetch
// is SSRF-guarded (private/reserved/metadata hosts are refused).
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractFromUrl, ExtractError } from '@/lib/ai/extract'
import { createAndIngestDocument } from '@/lib/ai/knowledge'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-url:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as
      | { url?: unknown; title?: unknown }
      | null
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!rawUrl) {
      return NextResponse.json({ error: 'A URL is required' }, { status: 400 })
    }

    let extracted
    try {
      extracted = await extractFromUrl(rawUrl)
    } catch (err) {
      if (err instanceof ExtractError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error('[ai/knowledge url] extract error:', err)
      return NextResponse.json({ error: 'Could not read that URL.' }, { status: 400 })
    }

    const titleOverride =
      typeof body?.title === 'string' ? body.title.trim() : ''

    const { id, warning } = await createAndIngestDocument(supabase, accountId, userId, {
      title: titleOverride || extracted.title,
      content: extracted.text,
      sourceType: 'url',
      sourceUrl: extracted.url,
    })

    return NextResponse.json({ success: true, id, warning })
  } catch (err) {
    return toErrorResponse(err)
  }
}
