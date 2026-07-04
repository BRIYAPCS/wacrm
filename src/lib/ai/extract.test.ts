import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  htmlToText,
  extractFromFile,
  extractFromUrl,
  ExtractError,
  MAX_SOURCE_BYTES,
} from './extract'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

vi.mock('@/lib/webhooks/ssrf', () => ({ isDeliverableUrl: vi.fn() }))
const mockDeliverable = vi.mocked(isDeliverableUrl)

describe('htmlToText', () => {
  it('extracts the title and readable text, dropping scripts/styles', () => {
    const html = `
      <html><head><title>Returns &amp; Refunds</title>
      <style>.x{color:red}</style></head>
      <body><script>evil()</script>
        <h1>Our policy</h1>
        <p>Return within <b>30 days</b> for a full refund.</p>
        <p>Contact us&nbsp;anytime.</p>
      </body></html>`
    const { title, text } = htmlToText(html)
    expect(title).toBe('Returns & Refunds')
    expect(text).toContain('Our policy')
    expect(text).toContain('Return within 30 days for a full refund.')
    expect(text).toContain('Contact us anytime.')
    expect(text).not.toContain('evil()')
    expect(text).not.toContain('color:red')
  })

  it('decodes numeric + named entities', () => {
    const { text } = htmlToText('<p>caf&#233; &amp; t&eacute;a &#x2665;</p>')
    expect(text).toContain('café')
    expect(text).toContain('&') // &amp;
  })
})

describe('extractFromFile', () => {
  const file = (name: string, mime: string, body: string) => ({
    buffer: Buffer.from(body, 'utf8'),
    filename: name,
    mimeType: mime,
  })

  it('reads plain text (txt / md / csv / json)', async () => {
    for (const [name, mime] of [
      ['notes.txt', 'text/plain'],
      ['guide.md', 'text/markdown'],
      ['data.csv', 'text/csv'],
      ['x.json', 'application/json'],
    ] as const) {
      const r = await extractFromFile(file(name, mime, 'hello world'))
      expect(r.text).toBe('hello world')
      expect(r.title.length).toBeGreaterThan(0)
    }
  })

  it('derives a readable title from the filename', async () => {
    const r = await extractFromFile(file('returns_policy-v2.txt', 'text/plain', 'x'))
    expect(r.title).toBe('returns policy v2')
  })

  it('parses HTML files through htmlToText', async () => {
    const r = await extractFromFile(
      file('page.html', 'text/html', '<title>Doc</title><p>Body text</p>'),
    )
    expect(r.title).toBe('Doc')
    expect(r.text).toContain('Body text')
  })

  it('rejects an empty file', async () => {
    await expect(extractFromFile(file('a.txt', 'text/plain', ''))).rejects.toBeInstanceOf(
      ExtractError,
    )
  })

  it('rejects an unsupported type', async () => {
    await expect(
      extractFromFile(file('a.exe', 'application/octet-stream', 'MZ')),
    ).rejects.toBeInstanceOf(ExtractError)
  })

  it('rejects an oversize file', async () => {
    const big = { buffer: Buffer.alloc(MAX_SOURCE_BYTES + 1), filename: 'b.txt', mimeType: 'text/plain' }
    await expect(extractFromFile(big)).rejects.toThrow(/10 MB/)
  })
})

describe('extractFromUrl — SSRF + size safety', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    mockDeliverable.mockReset()
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('re-validates redirect targets and refuses an internal bounce', async () => {
    // Original host is public; the redirect target (metadata IP) is not.
    mockDeliverable.mockImplementation(
      async (u: string) => new URL(u).hostname === 'good.com',
    )
    global.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
    ) as unknown as typeof fetch

    await expect(extractFromUrl('https://good.com/x')).rejects.toThrow(
      /private or unreachable/,
    )
    // The redirect target must have been re-checked (not just the original).
    expect(mockDeliverable).toHaveBeenCalledWith(
      expect.stringContaining('169.254.169.254'),
    )
  })

  it('follows a redirect to an allowed host and reports the final URL', async () => {
    mockDeliverable.mockResolvedValue(true)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'https://good.com/final' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<title>Hi</title><p>Body text</p>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ) as unknown as typeof fetch

    const r = await extractFromUrl('https://good.com/start')
    expect(r.text).toContain('Body text')
    expect(r.url).toBe('https://good.com/final')
  })

  it('aborts an oversize streamed body with no content-length', async () => {
    mockDeliverable.mockResolvedValue(true)
    const oversize = new Uint8Array(MAX_SOURCE_BYTES + 1024)
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(oversize)
        c.close()
      },
    })
    global.fetch = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch

    await expect(extractFromUrl('https://good.com/big')).rejects.toThrow(/10 MB/)
  })

  it('refuses a URL whose own host is private before fetching', async () => {
    mockDeliverable.mockResolvedValue(false)
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    await expect(extractFromUrl('http://127.0.0.1/x')).rejects.toThrow(
      /private or unreachable/,
    )
    expect(spy).not.toHaveBeenCalled()
  })
})
