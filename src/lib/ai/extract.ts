import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

// ============================================================
// Text extraction for the knowledge base — from uploaded files (PDF,
// DOCX, TXT, MD, CSV, JSON, HTML) and from web pages (fetch a URL, pull
// out the readable text). Everything returns plain `{ title, text }`
// that feeds the existing chunk + embed pipeline unchanged.
//
// The heavy parsers (unpdf for PDF, mammoth for DOCX) are dynamically
// imported inside their branch so they only load when actually needed.
// ============================================================

/** Max size we'll accept for an upload or a fetched URL body. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024 // 10 MB
/** Cap extracted text so a giant file can't blow up chunking/embedding. */
export const MAX_TEXT_CHARS = 500_000
const FETCH_TIMEOUT_MS = 20_000

/** Typed failure so routes can return a clean 400 with the reason. */
export class ExtractError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ExtractError'
    this.status = status
  }
}

export interface Extracted {
  title: string
  text: string
}

// ---- HTML → text (dependency-free, best-effort) ------------
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    const key = code.toLowerCase()
    if (key in ENTITIES) return ENTITIES[key]
    if (key.startsWith('#x')) {
      const n = parseInt(key.slice(2), 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    if (key.startsWith('#')) {
      const n = parseInt(key.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return m
  })
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : ''

  const text = decodeEntities(
    html
      // Drop non-content elements wholesale.
      .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      // Turn block boundaries into newlines so paragraphs survive.
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      // Strip every remaining tag.
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim()

  return { title, text }
}

function cap(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename
}

// ---- from an uploaded file ---------------------------------
export async function extractFromFile(args: {
  buffer: Buffer
  filename: string
  mimeType: string
}): Promise<Extracted> {
  const { buffer, filename, mimeType } = args
  if (buffer.byteLength === 0) throw new ExtractError('The file is empty.')
  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new ExtractError('File is larger than the 10 MB limit.')
  }

  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  const mime = mimeType.toLowerCase()

  // PDF
  if (ext === 'pdf' || mime.includes('pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf')
    let text: string
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const res = await extractText(pdf, { mergePages: true })
      text = Array.isArray(res.text) ? res.text.join('\n') : res.text
    } catch (err) {
      throw new ExtractError(
        `Could not read the PDF: ${err instanceof Error ? err.message : 'parse error'}`,
      )
    }
    if (!text.trim()) {
      throw new ExtractError(
        'No text found in the PDF — it may be a scanned image (OCR not supported).',
      )
    }
    return { title: baseName(filename), text: cap(text) }
  }

  // DOCX
  if (ext === 'docx' || mime.includes('officedocument.wordprocessingml')) {
    const mammoth = await import('mammoth')
    let text: string
    try {
      const res = await mammoth.extractRawText({ buffer })
      text = res.value
    } catch (err) {
      throw new ExtractError(
        `Could not read the Word document: ${err instanceof Error ? err.message : 'parse error'}`,
      )
    }
    if (!text.trim()) throw new ExtractError('No text found in the document.')
    return { title: baseName(filename), text: cap(text) }
  }

  // HTML
  if (ext === 'html' || ext === 'htm' || mime.includes('html')) {
    const { title, text } = htmlToText(buffer.toString('utf8'))
    if (!text.trim()) throw new ExtractError('No readable text in the HTML file.')
    return { title: title || baseName(filename), text: cap(text) }
  }

  // Plain-text family: txt / md / csv / json / anything text/*
  if (
    ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml'].includes(ext) ||
    mime.startsWith('text/') ||
    mime.includes('json')
  ) {
    const text = buffer.toString('utf8')
    if (!text.trim()) throw new ExtractError('The file has no text.')
    return { title: baseName(filename), text: cap(text) }
  }

  throw new ExtractError(
    `Unsupported file type "${ext || mime}". Supported: PDF, DOCX, TXT, MD, CSV, JSON, HTML.`,
  )
}

// ---- from a URL --------------------------------------------
export async function extractFromUrl(rawUrl: string): Promise<Extracted & { url: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ExtractError('Enter a valid URL (including http:// or https://).')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExtractError('Only http(s) URLs are supported.')
  }

  // SSRF guard — refuse private / reserved / metadata hosts (reuses the
  // same DNS-resolving check the outbound webhooks use).
  if (!(await isDeliverableUrl(url.toString()))) {
    throw new ExtractError('That URL points to a private or unreachable address.')
  }

  let res: Response
  try {
    res = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        // A UA + Accept help some sites return real HTML.
        'User-Agent': 'wacrm-knowledge-bot/1.0',
        Accept: 'text/html,application/pdf,text/plain,*/*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ExtractError('The page took too long to respond.', 504)
    }
    throw new ExtractError('Could not reach that URL.', 502)
  }

  if (!res.ok) {
    throw new ExtractError(`The page returned HTTP ${res.status}.`, 502)
  }

  const lenHeader = Number(res.headers.get('content-length'))
  if (Number.isFinite(lenHeader) && lenHeader > MAX_SOURCE_BYTES) {
    throw new ExtractError('That page is larger than the 10 MB limit.')
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_SOURCE_BYTES) {
    throw new ExtractError('That page is larger than the 10 MB limit.')
  }

  // PDF served at a URL.
  if (contentType.includes('pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf')
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const r = await extractText(pdf, { mergePages: true })
      const text = Array.isArray(r.text) ? r.text.join('\n') : r.text
      if (!text.trim()) throw new ExtractError('No text found in the linked PDF.')
      return { title: url.hostname + url.pathname, text: cap(text), url: url.toString() }
    } catch (err) {
      if (err instanceof ExtractError) throw err
      throw new ExtractError('Could not read the linked PDF.')
    }
  }

  if (contentType.includes('html') || contentType === '') {
    const { title, text } = htmlToText(buf.toString('utf8'))
    if (!text.trim()) throw new ExtractError('No readable text found on that page.')
    return { title: title || url.hostname, text: cap(text), url: url.toString() }
  }

  if (contentType.startsWith('text/') || contentType.includes('json')) {
    const text = buf.toString('utf8')
    if (!text.trim()) throw new ExtractError('That URL returned no text.')
    return { title: url.hostname + url.pathname, text: cap(text), url: url.toString() }
  }

  throw new ExtractError(`Unsupported content type "${contentType}" at that URL.`)
}
