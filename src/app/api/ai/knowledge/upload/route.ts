// ============================================================
// POST /api/ai/knowledge/upload  (admin+, multipart/form-data)
//
// Upload a document (PDF, DOCX, TXT, MD, CSV, JSON, HTML) → extract its
// text server-side → store + chunk + embed like any KB entry.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, requireFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractFromFile, ExtractError, MAX_SOURCE_BYTES } from '@/lib/ai/extract'
import { createAndIngestDocument } from '@/lib/ai/knowledge'

// PDF/DOCX parsing needs the Node runtime, and a big file can take a
// moment to extract + embed.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    requireFeature(ctx, 'ai', 'The AI knowledge base')
    const { supabase, accountId, userId } = ctx
    const limit = checkRateLimit(`ai-kb-upload:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    if (file.size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { error: 'File is larger than the 10 MB limit.' },
        { status: 400 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let extracted
    try {
      extracted = await extractFromFile({
        buffer,
        filename: file.name,
        mimeType: file.type || '',
      })
    } catch (err) {
      if (err instanceof ExtractError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error('[ai/knowledge upload] extract error:', err)
      return NextResponse.json({ error: 'Could not read the file.' }, { status: 400 })
    }

    const titleOverride =
      typeof form?.get('title') === 'string' ? (form.get('title') as string).trim() : ''

    const { id, warning } = await createAndIngestDocument(supabase, accountId, userId, {
      title: titleOverride || extracted.title,
      content: extracted.text,
      sourceType: 'file',
    })

    return NextResponse.json({ success: true, id, warning })
  } catch (err) {
    return toErrorResponse(err)
  }
}
