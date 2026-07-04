# AI assistant — providers & knowledge base

The AI assistant drafts replies in the inbox and can run an optional
auto-reply bot, grounded in **your own content** via a knowledge base.
Everything is **per account** and **bring-your-own-key** — there is no
global AI key and no per-seat AI fee. Keys are encrypted at rest under
`ENCRYPTION_KEY`.

Configure it all in **Settings → AI**.

> **Migrations.** The AI features ship across a few migrations — the
> baseline (`029_ai_reply.sql`, `030_ai_knowledge.sql`), multi-provider
> support (`046_ai_providers.sql`), and document/URL sources
> (`047_ai_knowledge_sources.sql`). `npm run db:deploy` applies whatever
> your database is missing; it's idempotent.

---

## 1. Pick a provider

Any of these works — choose one, paste its API key, pick a model (a
sensible default is pre-filled):

| Provider | Default model | Notes |
|---|---|---|
| **OpenAI** | `gpt-5.4-mini` | |
| **Anthropic (Claude)** | `claude-haiku-4-5` | Native adapter |
| **Google Gemini** | `gemini-2.0-flash` | OpenAI-compatible endpoint |
| **Azure OpenAI** | `gpt-4o-mini` | Needs your **endpoint URL** (`base_url`) |
| **OpenRouter** | `openai/gpt-4o-mini` | Gateway to many models |
| **Groq** | `llama-3.3-70b-versatile` | |
| **DeepSeek** | `deepseek-chat` | |
| **Mistral** | `mistral-small-latest` | |
| **Together AI** | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | |
| **xAI (Grok)** | `grok-2-latest` | |
| **Zhipu GLM** | `glm-4-flash` | |
| **Custom / Self-hosted** | _(you set the model)_ | Any OpenAI-compatible endpoint |

Every OpenAI-shaped provider runs through one adapter (base URL + auth
style); Anthropic keeps its native adapter. You can point at any model
the provider exposes — the default is only a starting point.

### Self-hosted / local models

Pick **Custom / Self-hosted (OpenAI-compatible)** and give it a
**base URL**. This covers **Ollama**, **LM Studio**, **LocalAI**,
**vLLM**, or any proxy that speaks the OpenAI chat API. Local servers
that need no key can be saved **keyless**.

> The endpoint must be reachable **from where the app runs** — not just
> from your laptop. On a hosted deploy, `http://localhost:11434` is the
> server's own loopback, not your machine. Validation on save is
> best-effort for custom endpoints: it saves with a warning if the
> endpoint can't be reached at that moment.

### Related environment variables (optional)

| Variable | Default | Purpose |
|---|---|---|
| `AI_REQUEST_TIMEOUT_MS` | `30000` | Per-call provider timeout |
| `AI_CONTEXT_MESSAGE_LIMIT` | `20` | Recent messages sent as context |

---

## 2. Drafting & auto-reply

- **One-click draft** — in any conversation, generate a suggested reply
  you can edit before sending. Nothing is sent automatically.
- **Auto-reply bot** (optional) — answers inbound messages on its own,
  with a **per-conversation cap** and a clean **handoff to a human** once
  the cap is hit or the customer needs one. Off by default.

Both use the recent conversation as context plus any relevant knowledge
(below).

---

## 3. Knowledge base

Give the assistant your own content and it answers **from your material**
instead of guessing. Add entries three ways in **Settings → AI →
Knowledge**:

1. **Type text** — paste FAQs, policies, product notes.
2. **Upload a document** — the server extracts the readable text:
   - **PDF** (`.pdf`) — text PDFs only; scanned/image-only PDFs can't be
     read (no OCR — you'll get a clear message to paste the text instead).
   - **Word** (`.docx`).
   - **Plain text** — `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.html`.
3. **Add a website by URL** — the server fetches the page (or a linked
   PDF / text file) and extracts its readable content.

Each entry shows a **source badge** (typed / file / website), and
website entries link back to their original URL.

### How it's used (retrieval)

Every entry is **chunked** and stored for search. At reply time the
assistant retrieves the most relevant chunks and grounds its answer on
them:

- **Keyword search** (Postgres full-text) always works — no key needed.
- **Semantic search** (pgvector) kicks in when you set an **embeddings
  key**. Chunks are embedded with OpenAI's `text-embedding-3-small`
  (1536-dim) at ingest, and the query is embedded at retrieval. Retrieval
  is **hybrid**: semantic-first, topped up with keyword matches.

The embeddings key is separate from the chat key (Anthropic and most
others have no embeddings endpoint, so this path always uses an
OpenAI-compatible key). **Without** an embeddings key, entries are still
fully usable — just keyword-searchable. If a key is missing or an embed
fails, the entry is **saved anyway** with a warning, and **Reindex**
retries the embedding later.

### Limits & safety

- **Size caps**: 10 MB per upload, ~500k characters per entry — bounds
  cost and abuse.
- **URL fetches are SSRF-guarded**: private, reserved, loopback, and
  cloud-metadata hosts are refused, so the fetcher can't be pointed at
  your internal network.
- Uploads and URL fetches are **admin-only** and rate-limited.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Saved, but semantic indexing failed…" | The chat saved fine and is keyword-searchable. Check the **embeddings key** and hit **Reindex**. |
| "…embeddings key could not be decrypted" | `ENCRYPTION_KEY` changed or is wrong — restore the original, then re-enter the key. |
| Self-hosted endpoint saves with a warning | The server couldn't reach the endpoint at save time. Confirm it's reachable **from the app host**, not just locally. |
| A scanned PDF won't upload | It's an image with no text layer (no OCR). Paste the text, or run OCR first and upload the result. |
| Assistant ignores a document | Confirm the entry appears in the list; if semantic search matters, set an embeddings key and **Reindex**. |
| Auto-reply never fires | Enable it in Settings → AI, and check the per-conversation cap hasn't already been reached. |
