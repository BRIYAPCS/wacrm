import { describe, it, expect } from 'vitest'
import { htmlToText, extractFromFile, ExtractError, MAX_SOURCE_BYTES } from './extract'

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
