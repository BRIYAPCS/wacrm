# Features — what wacrm does

A module-by-module reference for the whole app. This is the "what's in the
box" overview; deep setup lives in the linked guides and in
**[DEPLOYMENT.md](../DEPLOYMENT.md)**.

Everything is **multi-tenant and account-scoped**: each account (team) sees
only its own data, enforced by Postgres Row-Level Security on every table.
Roles are **owner › admin › agent › viewer**.

---

## Shared inbox

The core of the product — a team inbox on the official WhatsApp Business
(Meta Cloud) API.

- One WhatsApp number staffed by the whole team; **per-conversation
  assignment**, status (open / pending / closed), and internal notes.
- **Multi-number**: an account can connect more than one WhatsApp number;
  each conversation remembers which number it's on and replies from it.
- Send **text, images, video, documents, and voice notes** from the
  composer; receive the same from customers. Media is stored in an
  account-scoped `chat-media` bucket.
- **Templates**: send Meta-approved message templates (with variable
  substitution) — required to open a conversation outside the 24-hour
  session window, which the UI tracks and surfaces.
- **Reactions, reply-quotes**, delivery/read receipts, date separators.
- **Realtime**: new messages, status changes, and assignments appear
  live; a reconnect/visibility resync backfills anything missed while the
  tab was asleep.
- **@mentions** in conversation notes notify the mentioned teammate.
- **Customisable chat wallpaper** — an account-wide default plus per-chat
  overrides (owner/admin set): presets, a custom colour, or an uploaded
  image. See the chat-background section of the app's Settings → Appearance.
- **Contact side panel**: tags, deals, and notes for the person you're
  talking to, without leaving the thread.

## Contacts

- Contacts with **tags**, **custom fields**, and company.
- **CSV import** with de-duplication.
- Tag-based filtering that the inbox and broadcasts reuse for audiences.

## Sales pipelines & deals

- **Kanban pipelines** with stages; drag deals between stages.
- Deals link back to the conversation and contact.
- Per-account **default currency**.

## Broadcasts

- Send a Meta-approved template to a **filtered audience** (by tag, etc.).
- Per-recipient **variable substitution**.
- **Delivery + read tracking** per recipient.

## Automations & Flows

A visual, no-code automation builder.

- **Triggers**: inbound message, new contact, keyword match, or schedule.
- **Actions/branches**: conditional logic, waits, tag changes, send
  message / media, webhooks.
- Runs on a **cron scheduler** (waits and scheduled sends fire on time).
- See **[automations-and-cron.md](./automations-and-cron.md)**.

## AI assistant

Bring-your-own-key, per account, encrypted at rest — no per-seat AI fee.

- **Any provider**: OpenAI, Anthropic, Google Gemini, Azure OpenAI,
  OpenRouter, Groq, DeepSeek, Mistral, Together, xAI, Zhipu GLM, or a
  **self-hosted / OpenAI-compatible** endpoint (Ollama, LM Studio, vLLM…).
- **One-click drafts** in the inbox, plus an optional **auto-reply bot**
  with a per-conversation cap and clean human handoff.
- **Knowledge base**: ground answers on your own content — typed text,
  **uploaded documents** (PDF, Word, text), or a **website URL** the
  server reads for you. Hybrid retrieval (Postgres full-text, or semantic
  pgvector when an embeddings key is set).
- Full guide: **[ai-assistant.md](./ai-assistant.md)**.

## Notifications

- A **live notification bell** in the header (every page) with an unread
  badge combining new messages and app alerts (assignments, @mentions).
- Dropdown with a **Messages** section (jump to the chat) and an
  **Alerts** section (open + mark read); a full `/notifications` page.
- Realtime — the badge updates as things arrive.

## Dashboard & reports

- Real-time dashboard: response times, daily volume, pipeline value, and a
  cross-module activity feed.
- Account report with attribution.

## Team, accounts & access

- **Invite-only** onboarding: the first user on a fresh instance becomes
  the **owner**; everyone else joins by **emailed invitation** (hashed,
  single-use, expiring tokens).
- Role-based access — **owner / admin / agent / viewer** — and
  **ownership transfer**. Random emails can't self-register (enforced in
  the database).
- Account management: profile, password, avatar, global sign-out, active
  sessions.
- **Audit log** of sensitive actions.

## Public REST API

- `/api/v1` with **scoped, revocable API keys** (hashed at rest) — build
  your own automations on top of your CRM.
- See **[public-api.md](./public-api.md)**.

## Plans & billing (subscription tiers)

- Sell the app in **Basic / Pro / Advanced** tiers from one codebase.
  Tiers gate whole modules (AI, Flows, Automations, Public API, multi-number,
  audit) and numeric limits (seats, numbers, contacts…).
- A hidden **`/superadmin`** console (vendor-only) sets each client's tier
  and per-account add-ons; **Stripe** can drive it automatically.
- See **[plans-and-billing.md](./plans-and-billing.md)**.

## Appearance

- Light/dark mode + accent-colour themes (device-scoped).
- Team-wide + per-chat **chat backgrounds** (owner/admin).

## Security primitives

- **RLS** on every table (account-scoped, role-aware).
- **AES-256-GCM** encryption for stored secrets (WhatsApp tokens, AI keys)
  under `ENCRYPTION_KEY`.
- **HMAC-verified** inbound WhatsApp webhooks; **SSRF-guarded** outbound
  fetches (webhooks + knowledge-base URL reads, re-validated across
  redirects).
- **Rate limiting** on sensitive routes; CSP; CI typecheck/lint/test/build
  on every PR.

---

## Where things live (setup guides)

| Area | Guide |
|---|---|
| Zero-to-live deploy | [DEPLOYMENT.md](../DEPLOYMENT.md) |
| Per-customer redeploy | [new-customer-checklist.md](./new-customer-checklist.md) |
| Database & one-command migrate | [database-setup.md](./database-setup.md) |
| AI assistant (providers + KB) | [ai-assistant.md](./ai-assistant.md) |
| Plans & billing (tiers) | [plans-and-billing.md](./plans-and-billing.md) |
| Automations, Flows & cron | [automations-and-cron.md](./automations-and-cron.md) |
| Email deliverability (SMTP) | [email-setup.md](./email-setup.md) |
| Public REST API | [public-api.md](./public-api.md) |
