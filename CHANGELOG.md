# Changelog

User-visible changes in `wacrm`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0, `MINOR` bumps cover new modules; `PATCH` bumps cover bug fixes
and polish.

## [0.22.0] — 2026-07-04

The AI assistant now works with **any provider**. **Migration required:**
apply `supabase/migrations/046_ai_providers.sql`.

### Added

- **Many AI providers** in Settings → AI: OpenAI, Anthropic, **Google
  Gemini, Azure OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, xAI,
  Zhipu GLM**, and a **Custom / Self-hosted (OpenAI-compatible)** option for
  any endpoint — Ollama, LM Studio, LocalAI, vLLM, or a proxy.
- **Custom endpoint (`base_url`)** field for Azure + self-hosted providers,
  with a **keyless** option for local servers that need no API key.
- One OpenAI-compatible adapter (base URL + auth style) covers every
  OpenAI-shaped provider; Anthropic keeps its native adapter. Adding a
  provider is now a one-entry change in the provider registry.

### Notes

- Existing OpenAI/Anthropic configs keep working unchanged.
- For a self-hosted model, the endpoint must be reachable from where the
  app runs; validation on save is best-effort for custom endpoints (it
  saves with a warning if the endpoint can't be reached at that moment).

## [0.21.1] — 2026-07-04

Deployment documentation + per-customer setup ergonomics. No migration, no
app-code change.

### Added

- **`DEPLOYMENT.md`** — a complete, self-contained zero-to-live guide
  (Supabase project, migrations, SMTP + Auth URLs for invites, WhatsApp
  webhook, cron, domain, env reference, troubleshooting).
- **`docs/new-customer-checklist.md`** — a tight copy-paste runbook for
  redeploying the app as an isolated instance per customer, incl. which
  secrets must never be reused across customers.
- **`npm run setup`** (`scripts/setup.mjs`) — assisted first-run: scaffolds
  `.env`, generates `ENCRYPTION_KEY` + `AUTOMATION_CRON_SECRET` (never
  overwriting a real key), and reports which required values are missing.

### Changed

- Docs now reflect **invite-only, email-based** onboarding: `README`,
  `docs/email-setup.md` (SMTP is effectively required), and
  `docs/database-setup.md` updated; `.env.local.example` documents
  `NEXT_PUBLIC_ALLOW_SIGNUP`.

## [0.21.0] — 2026-07-04

Locks the instance to **invite-only sign-up** (Stage B). **Migration
required:** apply `supabase/migrations/045_invite_only.sql`.

### Changed

- **Public sign-up is now off.** A random email can no longer self-register
  — enforced at the database level (the sign-up trigger rejects it), so it
  holds even against a direct API call, not just the hidden form. New
  members join only via an admin email invitation (v0.20.0).
- `/signup` shows an "invitation required" message, and the login page
  drops the "create account" prompt.

### No-lockout guarantees

- **Invited users always get in**, and **the first user on a fresh deploy**
  (an instance with no accounts yet) still bootstraps the workspace as owner
  — so a new install works with no special steps.
- Escape hatch — to temporarily re-open public sign-up:
  `UPDATE app_settings SET public_signup_enabled = true;` (and set
  `NEXT_PUBLIC_ALLOW_SIGNUP=true` to bring the form back).

### Note

- Adding teammates now depends on email invites, which need **SMTP
  configured in your Supabase project** (see v0.20.0). Existing members
  (including you) are unaffected — you keep your session and account.

## [0.20.0] — 2026-07-04

Adds **invite teammates by email** (Stage A of invite-only onboarding).

**Migration required:** apply `supabase/migrations/044_invite_by_email.sql`.
**Setup required:** configure **SMTP in your Supabase project** (Auth →
SMTP) so the invite emails actually deliver — Supabase's built-in mailer is
heavily rate-limited and not for production.

### Added

- **Email invitations.** In Settings → Team members, an admin enters an
  email + role and we send that address a secure Supabase invite link. The
  invitee sets a password on a new **/accept-invite** page and lands
  attached to your account with the assigned role — no link to copy/paste.
- **Email-pinned.** The invite is tied to that exact address (only they can
  accept), and can't create an `owner`. Revoking an invite also cancels the
  pending sign-in so the address can be re-invited.
- The pending-invitations list now shows the invited email.

### Notes

- This is **Stage A** — it does not yet disable public sign-up; anyone can
  still register their own account. Locking the instance to invite-only
  (Stage B) is a separate, deliberate change.
- `handle_new_user` now attaches invited users to the inviting account
  instead of giving them a personal one; uninvited sign-up is unchanged.

## [0.19.8] — 2026-07-04

UI polish — the remaining low-severity items from the review. No migration.

### Fixed

- **Contact details**: a fast contact→contact switch can no longer briefly
  paint the previous contact's data (out-of-order fetches are now guarded),
  and a contact deleted while its panel is open shows a clear "not
  available" message instead of spinning forever.
- **Contacts search** is debounced (~300ms) — typing no longer fires a
  query per keystroke.
- **Deal form**: editing no longer gets wiped if the currency setting
  resolves while the sheet is open; the form only resets when it opens or
  switches to a different deal.
- **Retry buttons** on the Automations / Broadcasts / Notifications error
  states now refetch in place instead of hard-reloading the whole app.
- Small guards: the AI playground no longer updates state after you switch
  away mid-request, and a flow "jump to node" from validation keeps the
  selected node highlighted.

## [0.19.7] — 2026-07-04

Reports → Team Performance now states its data horizon. **Migration
required:** apply `supabase/migrations/043_account_report_attribution.sql`.

### Added

- **Team Performance is now self-describing.** Per-agent counts are
  attributed by who sent each message, which is only recorded from when
  agent attribution was added — so a long range could look like an agent
  did less than they really did. The card now spells out that it counts
  only signed-in-agent sends (not automated AI/away/flow replies), and,
  when the selected range reaches back before attribution began, shows the
  date **"per-agent tracking began …"** so older days don't read as
  zero activity. (We intentionally don't back-fill historical attribution —
  it can't be told apart from automated sends, which would inflate agents'
  numbers.)

## [0.19.6] — 2026-07-04

### Fixed

- **Flow builder: deleting a connection now works on the canvas.** Edges
  are derived from node config and had no way to hold a "selected" state,
  so clicking an edge and pressing Delete/Backspace did nothing. Edge
  selection is now tracked and fed back into the canvas, so a selected
  connection highlights and the Delete key clears it (same behavior nodes
  already had).

## [0.19.5] — 2026-07-04

### Fixed

- **Scheduled messages no longer get silently stuck.** If a worker was
  interrupted mid-send, the row could stay in `sending` forever — never
  retried and never surfaced. The cron now reaps rows stuck in `sending`
  for over 10 minutes and marks them **failed** (rather than re-queuing,
  which could double-text a customer whose message already went out), so
  the state is visible and can be rescheduled.

## [0.19.4] — 2026-07-04

UI robustness — crash guards, error boundaries, and correctness fixes from
the deep review. No migration.

### Added

- **Error boundaries + 404.** A crash in any page now shows a friendly
  "something went wrong / try again" panel (the dashboard one keeps the
  sidebar) instead of a white screen, plus a styled **404** page and a
  dependency-free root-level fallback for the rare root-layout error.

### Fixed

- **New accounts now get their default "Sales Pipeline".** The one-shot
  seed guard was consumed before the account id loaded, so brand-new users
  were stranded on the empty state permanently.
- **Broadcast review shows the real recipient count for custom-field
  audiences** (it previously said "0 contacts" while actually sending to
  the matches). The review now uses the exact same resolver as the send.
- **"Verify with Meta" no longer white-screens** on an expired session or
  server error.
- **Deleting the last contacts on a page** no longer strands you on an
  empty list — it steps back a page.
- **Dashboard chart** no longer flashes a skeleton over already-loaded data
  when switching back to a cached range, and no longer crashes if the
  pointer is over it while the range shrinks.
- **Flow builder**: button/list-row ids are now collision-proof (deleting a
  middle item then adding one could previously duplicate an id and mis-wire
  branches); unknown node types render a safe placeholder instead of
  crashing; creating a flow no longer double-submits on Enter.
- **Broadcast audience estimate** is debounced and guarded, so typing a
  filter value no longer spams queries or shows a stale count.
- **Notifications realtime** is now account-filtered and re-subscribes on
  account switch.

## [0.19.3] — 2026-07-04

Inbound data-integrity hardening (from a deep review). **Migration
required:** apply `supabase/migrations/042_inbound_integrity.sql`.

### Fixed

- **Duplicate WhatsApp messages / double-processing on redelivery.** Meta
  delivers webhooks at-least-once; a redelivered inbound could insert a
  duplicate bubble, double-count unread, and re-fire automations, flows,
  and the AI auto-reply (customer double-texted). A new unique index on
  `messages (conversation_id, message_id)` plus idempotent handling now
  make redeliveries a no-op.
- **Duplicate conversation threads / inbox fragmentation.** There was no
  unique key on `conversations (account_id, contact_id)`, so a race or a
  contact merge could create a second thread for one contact — after which
  every future inbound spawned yet another thread. Added the unique index
  (with a one-time cleanup that collapses any existing duplicates) and
  race-recovery in all find-or-create paths.
- **Inbox checkmarks could go backwards.** Out-of-order Meta status
  webhooks (a late "sent" after "delivered"/"read") regressed a message's
  stored status. Status changes are now forward-only, matching the
  broadcast side.
- **Automation side effects could be dropped on serverless.** The webhook's
  automation dispatch was fire-and-forget; it's now awaited inside
  `after()` so a frozen function can't lose the work.
- A throwing message in a batched webhook no longer aborts the rest; the
  away auto-reply no longer pauses an active flow.

## [0.19.2] — 2026-07-04

Performance. **Migration required:** apply
`supabase/migrations/041_performance_indexes.sql`.

### Performance

- **Faster inbox and message threads at scale.** Added composite indexes
  matching the two hottest queries' filter + sort:
  `conversations (account_id, last_message_at DESC)` and
  `messages (conversation_id, created_at)`. Previously Postgres index-
  scanned the filter and then did a separate in-memory sort on every
  inbox load and every thread open; the composite indexes supply the
  order directly, removing the sort step (verified with `EXPLAIN` — the
  `Sort` node disappears). The messages index also speeds the Reports
  aggregation. Purely additive; no behavior change.

## [0.19.1] — 2026-07-04

Fixes from a full-app review (functionality + responsiveness). No migration.

### Fixed

- **Reports → Team Performance was always zero.** Agent sends never wrote
  `messages.sender_id`, so the per-agent breakdown counted nothing. Human
  (dashboard) sends now record the sender, so messages-sent and
  conversations-handled populate correctly going forward. (Automated
  AI/away/API sends stay unattributed by design.)
- **Audit-log entries could be silently dropped on serverless.** Writes
  were fire-and-forget, so the function could freeze before the insert
  landed. `recordAudit` now hands the write to `after()`, matching the
  inbound webhook's durability guarantee.
- **Tag-apply matched tag names as SQL `LIKE` patterns.** A name with `%`
  or `_` (e.g. "50%") could attach the wrong tag or create a duplicate;
  names are now matched literally.
- **Contact details were unreachable in the inbox on phones/tablets.** The
  contact panel (tags, deals, notes) was desktop-only with no way in below
  `lg`. The thread header now has a contact-info button that opens the
  panel in a drawer on small screens.
- **Tall dialogs could clip on short/landscape screens.** The base dialog
  now caps its height and scrolls instead of overflowing the viewport.
- **Contacts page header buttons could overflow on narrow phones** — they
  now wrap.

## [0.19.0] — 2026-07-04

Makes wacrm an **installable PWA** — add it to a phone or desktop home
screen and launch it in its own window.

No migration. Nothing to configure; the service worker registers itself
in production builds.

### Added

- **Web app manifest** (`/manifest.webmanifest`) — name, brand icons,
  `standalone` display, and a dark theme/splash so launch has no color
  flash.
- **Install icons** — 192, 512, and maskable-512 PNGs plus a 180px
  Apple touch icon (brand violet + chat mark).
- **Service worker** (`public/sw.js`) — offline shell + smart caching:
  cache-first for hashed Next assets, stale-while-revalidate for icons/
  fonts, network-first for navigations with an offline fallback.
  Deliberately **never caches `/api` or Supabase** responses, so data is
  never stale. Registers only in production (so it can't fight dev HMR).
- **iOS standalone metadata** (`appleWebApp`) for add-to-home-screen on
  Apple devices; `worker-src`/`manifest-src` added to the CSP so both keep
  working if the policy is later enforced.

## [0.18.0] — 2026-07-04

Adds an **audit log** — a tamper-resistant record of sensitive account
changes for owners and admins.

**Migration required:** apply `supabase/migrations/040_audit_log.sql`
(adds the `audit_logs` table + an admin-only read policy).

### Added

- **Audit log** (Settings → Audit log, admin+). A newest-first, paginated
  trail of who did what, when. Instrumented actions:
  - **Team** — role changed, member removed, invitation created/revoked,
    ownership transferred.
  - **WhatsApp numbers** — number added, removed, renamed, default changed.
- **Tamper-resistant by design.** Rows are written server-side only (via
  the service-role client); `audit_logs` has **no** insert/update/delete
  policy, so a member session can neither forge nor erase history.
  `actor_label` snapshots the actor's name at action time, so the trail
  stays readable after someone leaves the account.
- **`GET /api/account/audit`** — cursor-paginated (`?before=`), admin+.

## [0.17.0] — 2026-07-04

Adds **multi-number support** — connect several WhatsApp numbers to one
account (e.g. Sales + Support) and run them all from one inbox.

**Migration required:** apply `supabase/migrations/039_multi_number.sql`
(relaxes the one-number-per-account limit, adds `is_default` / `label` to
`whatsapp_config` and `whatsapp_config_id` to `conversations`, plus a
single-default trigger and backfill). Existing numbers are migrated
automatically: your current number becomes the default and every
conversation is stamped with it — no reconnection needed.

### Added

- **Multiple numbers per account.** Add a second (third, …) number from
  Settings → WhatsApp using the same connection form. A **Connected
  numbers** panel lists them all and lets you **set the default**,
  **rename**, or **remove** a number.
- **Per-conversation number tracking.** Each thread records which of your
  numbers it's on. Inbound messages re-point the thread to the number the
  customer used, and **replies go out from that same number** — agent
  sends, AI auto-replies, away messages, flows, and automations all
  respect it. The inbox header shows a small badge of the active number
  (only when you have more than one).
- **Default number** for outbound with no thread context — public-API
  sends and broadcasts go from the default.
- **Numbers API:** `GET /api/whatsapp/config/list`, plus `PATCH` (rename /
  set-default) and per-id `DELETE` on `/api/whatsapp/config`.

### Changed

- Every WhatsApp code path that previously assumed a single number
  (sending, media proxy, reactions, templates, broadcasts, registration
  diagnostics, the inbox connected-banner) now resolves the correct
  number via a shared resolver, so nothing breaks once a second number is
  connected.

## [0.16.0] — 2026-07-04

Adds a dedicated **Reports** page for analytics over time.

**Migration required:** apply `supabase/migrations/038_account_report.sql`
(adds the `account_report` aggregation function).

### Added

- **Reports page** (`/reports`, sidebar entry after Dashboard). Pick a
  7 / 30 / 90-day window and see:
  - **Summary tiles** — conversations started, new contacts, messages
    received, messages sent, and average first-response time.
  - **Message volume** — a per-day inbound-vs-outbound bar chart, bucketed
    in the account's configured timezone.
  - **Team performance** — a per-agent table of messages sent and
    conversations handled in the range.
- **`account_report` RPC.** All aggregation runs server-side in a single
  `SECURITY DEFINER` function (membership-checked via `is_account_member`),
  so totals stay accurate over long ranges instead of truncating at
  PostgREST's 1000-row page cap. Backs `GET /api/reports?days=7|30|90`.

## [0.15.0] — 2026-07-04

Adds **AI conversation summary** with sentiment and one-click tagging.

### Added

- **Summarize with AI.** An action in the inbox contact panel (agent+)
  reads the conversation and returns a 2–3 sentence summary, a **sentiment**
  badge (positive / neutral / negative), and up to four **suggested tags**
  — tap one to apply it to the contact (creating the tag if it doesn't
  exist yet). Uses your account's BYO provider/key; read-only (nothing is
  sent or stored). Works even with the auto-reply switch off. Backed by
  `POST /api/ai/summarize` and `POST /api/contacts/[id]/tags`. No
  migration.

## [0.14.0] — 2026-07-04

Adds **business hours** with an optional **away auto-reply**.

### Added

- **Business hours + away auto-reply.** Under **Settings → Business
  hours** (admin+), set your timezone and a per-weekday open/close
  schedule, and optionally an away message. When enabled, an inbound
  message received outside your hours gets the away reply — once per
  customer per closed period (throttled), and skipped when a flow or the
  AI assistant already handles the message, so a closed-hours customer
  gets one clear reply rather than two. The webhook evaluates the
  schedule in your account timezone. Backed by
  `/api/account/business-hours`.
  **Migration required:** `supabase/migrations/037_business_hours.sql`
  adds `accounts.timezone` / `business_hours` / `away_auto_reply_enabled`
  / `away_message` and `conversations.away_replied_at`. Idempotent —
  apply with `npm run db:deploy`.

## [0.13.0] — 2026-07-04

Adds **internal notes with @mentions** — teammates collaborate inside a
conversation without the customer ever seeing it.

### Added

- **Internal notes.** A collapsible "Internal notes" panel in each
  conversation thread (agent+ to add, everyone can read). Notes are
  team-only and never sent to WhatsApp. Type `@` to mention a teammate
  (autocomplete); the mentioned member gets a **notification** that links
  back to the conversation. Notes appear live via realtime. Backed by
  `/api/conversations/[id]/notes`.
  **Migration required:** `supabase/migrations/036_conversation_notes.sql`
  adds the `conversation_notes` table + RLS, a `mention` notification
  type, a SECURITY DEFINER trigger that notifies @mentioned members, and
  realtime. Idempotent — apply with `npm run db:deploy`.

## [0.12.0] — 2026-07-04

Adds **round-robin auto-assignment** — new inbound conversations are
distributed across your team automatically.

### Added

- **Auto-assignment.** Turn it on under **Settings → Team members**
  (admin+) and each brand-new inbound conversation is assigned to the
  next agent in rotation, so nothing sits unclaimed. Choose who's in the
  rotation per member. The pick is an atomic, concurrency-safe database
  function that locks the account row, so two simultaneous inbound
  messages can't hand the same slot to two agents. Backed by
  `/api/account/auto-assign`.
  **Migration required:** `supabase/migrations/035_auto_assignment.sql`
  adds `accounts.auto_assign_enabled` + a rotation cursor,
  `profiles.assignable`, and the `assign_next_agent` RPC. Idempotent —
  apply with `npm run db:deploy`.

## [0.11.0] — 2026-07-04

Adds **full-text search** across your conversations.

### Added

- **Inbox search.** The conversation-list search box now searches *every*
  conversation in the account — by **message content** (Postgres
  full-text) and by **contact** name / phone / company / email — not just
  the currently-loaded list. Results show the matching message excerpt and
  open the conversation on click. Runs under the caller's RLS, so tenancy
  is enforced by the existing policies. Backed by `GET /api/search`.
  **Migration required:** `supabase/migrations/034_message_search.sql`
  adds a generated `fts` tsvector + GIN index on `messages`. Idempotent —
  apply with `npm run db:deploy` (the stored column backfills existing
  rows once).

## [0.10.0] — 2026-07-04

Adds **scheduled messages (send-later)** — compose a message now and have
it delivered automatically at a future time.

### Added

- **Scheduled messages.** In the inbox composer, tap the calendar-clock
  button to schedule the typed message for later; upcoming sends appear
  in a strip above the composer and can be canceled (agent+). Delivered
  by the cron drain `GET /api/scheduled-messages/cron` (claimed with a
  `pending → sending` transition so overlapping ticks can't double-send),
  reusing the shared send core. v1 is text-only. Backed by
  `/api/scheduled-messages`.
  **Migration required:** `supabase/migrations/033_scheduled_messages.sql`
  adds the `scheduled_messages` table + RLS (member read / agent+ write).
  Idempotent — apply with `npm run db:deploy`.

### Changed

- The cron pinger now drives **three** endpoints (automations, flows, and
  scheduled messages). The committed GitHub Actions workflow and
  `scripts/cron-ping.sh` already include the new one; if you run your own
  scheduler, add `/api/scheduled-messages/cron` — see
  [docs/automations-and-cron.md](./docs/automations-and-cron.md).

## [0.9.0] — 2026-07-04

Adds **saved replies (canned responses)** — reusable message snippets
your team inserts in the inbox with a `/shortcut`.

### Added

- **Saved replies.** Manage account-shared snippets under **Settings →
  Saved replies** (agent+ to edit, everyone can use). In the inbox
  composer, type `/` to open a filterable picker (↑/↓ + Enter) or click
  the saved-replies button; the snippet is inserted with merge fields
  resolved — `{{contact.name}}`, `{{contact.phone}}`,
  `{{contact.company}}`, `{{contact.email}}`, `{{agent.name}}`,
  `{{account.name}}`. Backed by `/api/canned-responses`.
  **Migration required:** `supabase/migrations/032_canned_responses.sql`
  adds the `canned_responses` table, RLS (member read / agent+ write),
  and a case-insensitive unique shortcut per account. Idempotent — apply
  with `npm run db:deploy`.

## [0.8.2] — 2026-07-04

### Fixed

- **New-flow dialog now scrolls.** With twelve templates (0.8.1) the
  gallery grew taller than the viewport and the dialog didn't scroll —
  the close button and the "start blank" input/button were unreachable.
  The body now scrolls while the header and footer stay pinned. Also
  fixes a latent typecheck error in the template test that a stale
  incremental cache had masked. No migration.

## [0.8.1] — 2026-07-04

### Added

- **Nine more starter flow templates**, bringing the New-flow gallery to
  twelve: **appointment booking**, **order status**, **feedback survey**,
  **after-hours responder**, **quote request** (validated email),
  **newsletter opt-in** (validated email), **support triage**, **event
  RSVP**, and an **abandoned-cart nudge** — a `manual`-trigger flow you
  launch from a conversation with **Run a flow**. All are
  clone-and-activate ready (they avoid account-specific tag IDs), and a
  test asserts every template passes activation validation. No migration.

## [0.8.0] — 2026-07-03

Operational hardening + Flows completion. Adds one-command database
deployment, self-service account deletion, a committed cron scheduler,
and finishes the Flows feature (input validation + manual run). Also
migrates to the Next.js 16 `proxy` convention.

### Added

- **One-command database deploy.** `npm run db:deploy` applies every
  `supabase/migrations/*.sql` in order to your project's Postgres,
  tracked in a `wacrm_schema_migrations` table so re-runs skip
  already-applied files. Reads `SUPABASE_DB_URL` (Supabase Session
  pooler) from `.env`. See
  [docs/database-setup.md](./docs/database-setup.md).
- **Account deletion (GDPR).** Owners can permanently delete the whole
  account from **Settings → Team members → Danger zone** — a
  type-the-name confirmation that removes all account data and every
  member's login. Backed by `DELETE /api/account`.
  **Migration required:** `031` (below).
- **Manual “Run a flow”.** Agents can launch any active flow for a
  contact from the inbox contact panel — the `manual` trigger is now
  usable end-to-end. Backed by `POST /api/flows/[id]/run` (agent+,
  rate-limited).
- **`collect_input` validation.** A collect-input flow node can now
  require the customer's reply to be an **email / phone number / custom
  regex**; a reply that fails is reprompted per the flow's fallback
  policy instead of advancing. Configured in the builder, enforced by
  the runner, and checked at save time.
- **Committed cron scheduler.** `.github/workflows/cron.yml` drives the
  automation Wait-step and flow-timeout endpoints every 5 minutes from
  GitHub's cloud — host-agnostic (works on Hostinger, Vercel, Railway, a
  VPS). Set `BASE_URL` + `CRON_SECRET` under the repo's **Settings →
  Secrets and variables → Actions** after deploying. See
  [docs/automations-and-cron.md](./docs/automations-and-cron.md).
- **Self-host docs in-repo.**
  [database-setup](./docs/database-setup.md),
  [automations-and-cron](./docs/automations-and-cron.md), and
  [email-setup](./docs/email-setup.md) (custom SMTP for password-reset
  email).

### Changed

- **`middleware.ts` → `proxy.ts`** — Next.js 16 renamed the file
  convention (`middleware` is deprecated). Same behaviour: session
  refresh + auth gating.
- **Cron auth is host-agnostic.** `/api/automations/cron` and
  `/api/flows/cron` accept the shared secret via `x-cron-secret` **or**
  `Authorization: Bearer` (Vercel Cron), through one constant-time
  `verifyCronSecret` helper — which also upgrades
  `/api/automations/cron` from a timing-unsafe compare.

### Fixed

- **Deleting an account owner no longer fails.**
  `accounts.owner_user_id` was `ON DELETE RESTRICT` — the only foreign
  key to `auth.users` that blocked deleting an owner (every signup
  creates an owned account), surfacing as an opaque error from the
  Supabase admin API. Switched to `ON DELETE CASCADE` so account/user
  deletion tears the tenant down cleanly. Part of migration `031`.
- **Timezone-flaky dashboard tests.** The `date-utils` tests built dates
  from UTC-parsed strings while the code reads the local day; switched
  to local `Date` construction so they pass in any timezone.

### Performance

- **Covering indexes for every foreign key** (migration `031`).
  Previously-unindexed FKs made cascade deletes sequential-scan ~two
  dozen tables — now that account deletion cascades tenant-wide, each FK
  has a supporting index.

### Migration required

- `supabase/migrations/031_fk_indexes_and_account_cascade.sql` — adds
  covering indexes on every previously-unindexed foreign key and
  switches `accounts.owner_user_id` from `RESTRICT` to `ON DELETE
  CASCADE`. Idempotent. Apply with `npm run db:deploy` (or the Supabase
  SQL editor) before deploying this version.

## [0.7.0] — 2026-07-02

Promotes the AI assistant to a first-class **AI Agents** section in the
sidebar — it's no longer tucked inside Settings.

### Added

- **AI Agents (sidebar).** A dedicated `/agents` area with two tabs:
  - **Playground** — a test chat to message your agent and see its
    grounded, multi-turn replies (and where it would hand off to a human)
    *before* it ever answers a real customer. Runs the exact same path as
    the auto-reply bot (knowledge-base retrieval + your provider), and
    works even before you flip the master switch on, so you can try, then
    enable. Backed by `POST /api/ai/playground`.
  - **Setup** — the provider/key, business context, knowledge base, and
    auto-reply controls (moved here from Settings → AI Assistant).

### Changed

- The AI configuration moved out of **Settings → AI Assistant** into the
  new **AI Agents** section. No data change — same account config, new
  home. No migration required.

## [0.6.0] — 2026-07-02

Adds an **AI knowledge base** so the assistant (0.5.0) can answer from
your own content instead of handing off. Paste FAQs, policies, or
product details under **Settings → AI Assistant → Knowledge base**; the
relevant excerpts are retrieved into every draft and auto-reply.

### Added

- **Knowledge base with hybrid retrieval.** Lexical Postgres full-text
  search works for every account with no extra credentials. Optional
  **semantic search** (pgvector, OpenAI `text-embedding-3-small`) turns
  on when you add an **embeddings key** — semantic-primary, topped up
  with lexical to fill the result set. Anthropic-only accounts (Anthropic
  has no embeddings API) keep the lexical path with zero extra setup.
- **Knowledge base manager** in Settings — add/edit/delete documents and
  a **Reindex** action to backfill embeddings after adding a key. Both
  drafts and the auto-reply bot are grounded in the retrieved excerpts,
  and the prompt still instructs the model to hand off (auto-reply) or
  say it will follow up (draft) when the KB doesn't cover the question.
  **Migration required:** apply `supabase/migrations/030_ai_knowledge.sql`
  (enables `pgvector`; adds `ai_knowledge_documents` + `ai_knowledge_chunks`
  and an `embeddings_api_key` column on `ai_configs`).

## [0.5.0] — 2026-07-02

Adds the **AI reply assistant** — bring-your-own-key. Each account
pastes its own OpenAI or Anthropic key under **Settings → AI
Assistant**; wacrm calls the provider directly with that key, so
there's no per-seat AI fee and your conversation data never leaves
your own infrastructure for a wacrm-run service. The key is stored
AES-256-GCM-encrypted at rest (same as WhatsApp tokens) and never
returned to the client after saving.

### Added

- **AI-drafted replies in the inbox.** A ✨ button in the composer
  (agent+) reads the recent conversation and drops a suggested reply
  into the box for the agent to edit and send. Read-only server-side —
  `POST /api/ai/draft` never sends or stores anything. Respects your
  business context / persona from the settings prompt.
- **AI auto-reply bot.** When enabled, inbound messages that no
  deterministic Flow consumed and that have no agent assigned get an
  automatic LLM reply. Bounded by a per-conversation cap
  (`auto_reply_max_per_conversation`, default 3) and a clean human
  handoff: when the model can't confidently help — or the customer
  asks for a person — it stays silent and leaves the message for a
  human, and won't auto-reply on that thread again until re-enabled.
  Flows always win over the bot.
- **Settings → AI Assistant** (admin+ to edit): pick provider + model,
  paste your key, add business context/tone, toggle the assistant and
  auto-reply, set the per-conversation cap, and **Test key** against
  the provider before saving.
- Providers: OpenAI (Chat Completions) and Anthropic (Messages) behind
  one interface; model is a free-text field with sensible defaults, so
  you can point it at any current model your key can access.
  **Migration required:** apply
  `supabase/migrations/029_ai_reply.sql` (adds `ai_configs` +
  per-conversation auto-reply columns on `conversations`).

## [0.4.0] — 2026-07-01

Completes the public API (#245): **outbound event webhooks** so
automations can *react* to activity instead of polling.

### Added

- **Outbound event webhooks (`/api/v1/webhooks`).** Register an HTTPS
  endpoint (scope `webhooks:manage`) to be POSTed to when an event
  happens in your account — `message.received`, `message.status_updated`,
  or `conversation.created`. Manage endpoints with
  `GET/POST /api/v1/webhooks` and `GET/PATCH/DELETE /api/v1/webhooks/{id}`.
  Each delivery is signed with an `X-Wacrm-Signature`
  (HMAC-SHA256 over `timestamp.body`) so receivers can verify
  authenticity and reject replays; the signing secret is returned once
  at creation and stored encrypted. Delivery is best-effort — an
  endpoint that fails repeatedly is auto-disabled after a threshold of
  consecutive failures. See `docs/public-api.md`.
  **Migration required:** apply
  `supabase/migrations/028_webhook_endpoints.sql`.
  ([#245](https://github.com/ArnasDon/wacrm/issues/245))

## [0.3.0] — 2026-07-01

Multi-user accounts ship. Every wacrm install is multi-tenant on the
database side: a single user's signup creates a fresh "account", and
every row is scoped to that account rather than to the user directly.
This release also opens the user-visible **Members** surface — invite
teammates by link, manage their roles, transfer ownership — to all
users. The `'account_sharing'` beta gate that hid it during
development is removed (mirrors the Flows soft-GA in 0.2.0). Existing
self-hosted instances keep working: every existing user is backfilled
as the sole owner of their own account and sees identical data, and a
solo owner who never invites anyone sees the same single-user app they
always did.

### Added

- **Public REST API (`/api/v1`) — groundwork.** A scoped, revocable
  **API key** system so you can drive wacrm from your own scripts and
  automations. Create keys under **Settings → API keys** (admin+),
  grant only the scopes each integration needs, and authenticate with
  `Authorization: Bearer <key>`. Keys are account-scoped and stored
  hashed (plaintext shown once). This release ships the auth layer,
  scopes, per-key rate limiting, the management UI, and a
  `GET /api/v1/me` probe to verify a key. See
  `docs/public-api.md`. **Migration required:** apply
  `supabase/migrations/026_api_keys.sql`. ([#245](https://github.com/ArnasDon/wacrm/issues/245))
- **Public REST API — data endpoints.** Built on the key auth above,
  so external automations can read and drive the CRM:
  - `POST /api/v1/messages` — send a text / template / media message to
    a phone number; finds-or-creates the contact + conversation
    (`messages:send`).
  - `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/{id}` —
    list (search + tag filter), create (find-or-create by phone), read,
    and update contacts, including tags (`contacts:read` /
    `contacts:write`).
  - `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}`, and
    `GET /api/v1/conversations/{id}/messages` — browse conversations and
    their message history with delivery status (`conversations:read` /
    `messages:read`).
  - `POST /api/v1/broadcasts` + `GET /api/v1/broadcasts/{id}` — launch a
    template broadcast to a recipient list and poll its progress
    (`broadcasts:send`).
  All list endpoints share one cursor-pagination contract
  (`{ data, meta: { next_cursor } }`). No migration required — the
  scopes already existed and the tables are unchanged. Outbound event
  webhooks (react to inbound messages) are the remaining roadmap item.
  See `docs/public-api.md`. ([#245](https://github.com/ArnasDon/wacrm/issues/245))

### Changed

- **Tenancy moves from per-user to per-account.** RLS on every
  domain table (contacts, conversations, messages, broadcasts,
  automations, flows, pipelines, templates, tags, …) now checks
  account membership via a new SECURITY DEFINER helper
  `is_account_member(account_id, min_role)` instead of
  `auth.uid() = user_id`. The `user_id` columns stay on every row
  for assignment / audit but no longer enforce isolation.
- **WhatsApp config is one-per-account, not one-per-user.** The
  `whatsapp_config.UNIQUE(user_id)` constraint is replaced by
  `UNIQUE(account_id)`.
- **`flow_runs` idempotency key swaps to `(account_id, contact_id)`**
  so two accounts sharing a contact phone number can each run their
  own flows independently.
- **The signup trigger (`handle_new_user`) now also creates a
  personal account** and links the new profile to it as `owner`.

### Changed

- **Flow-media storage is now account-scoped.** Migration 016
  pathed uploaded files under `auth.uid()/...`, which orphaned
  flow media when a teammate left a shared account. New uploads
  go under `account-<account_id>/...` and any account member
  with the right role can edit them. Legacy paths remain
  writable by the original uploader for backward compatibility.
- **Webhook contact lookup now pre-filters in SQL.** Previously
  pulled every contact in an account just to JS-filter to one
  row by phone — fine when account = one user, painful when
  account = team. Pre-filter by phone suffix on the database
  side; re-apply `phonesMatch` on the (typically 0-2 row)
  candidate set.

### Migration required

- `supabase/migrations/020_account_sharing_followups.sql` —
  composite partial indexes on `automations(account_id,
  trigger_type) WHERE is_active` and `flows(account_id) WHERE
  status='active'` for the engine dispatch hot path; updated
  `flow-media` storage RLS to allow account-member writes under
  the new path convention. Idempotent.

- **Role-aware UI gating across the app.** The inbox composer's
  send button + textarea, the "New broadcast / automation / flow"
  buttons, the "Add pipeline / deal" buttons, and the "Add /
  Import contact" buttons are now disabled-with-tooltip for
  viewers (and for agents on settings-class actions). Choice:
  show-but-disable rather than hide, so the UI never feels
  silently broken to a teammate looking at a feature they don't
  yet have permission for.
- **Sidebar surfaces the active account** above the user info
  whenever the account name differs from your own — i.e. once
  you've renamed the account or joined a shared one. A default
  solo account is named after you, so the strip stays hidden to
  avoid duplicating your name in the footer.
- **Members is open to all users.** The `account_sharing` beta
  flag that hid the Settings → Members tab and the sidebar
  account strip during development is gone; the multi-user
  surface is now part of the standard app. (Same soft-GA move as
  Flows in 0.2.0.)

### Fixed

- **Inbound WhatsApp messages now land in the shared inbox.** The
  webhook + automations + flows engines used to route inbound
  events by `user_id`, which after the 017 migration only matched
  the WhatsApp config owner's automations / flows — teammates'
  rules never fired. PR 8 of the multi-user series flips every
  lookup to `account_id` so any member of the account sees the
  inbound message and any teammate's automation or flow can react
  to it. Also fixes incipient NOT NULL violations on
  `automation_logs`, `automation_pending_executions`, `flow_runs`,
  and `deals` — those tables gained `account_id NOT NULL` in 017
  but the engines hadn't yet been updated to populate it.

### Added

- **Duplicate phone numbers are now prevented across contacts.** A
  phone number can no longer become more than one contact in the same
  account. Adding a contact whose number already exists is blocked
  with a link to the existing record (and a softer warning for
  near-matches that share their last 8 digits); CSV import de-dupes
  within the file and against existing contacts, reporting
  "X imported, Y duplicates skipped". The rule is enforced by a
  database unique index on the normalized number, so the WhatsApp
  webhook, the form, import, and any future path all agree. Existing
  duplicates are merged into the oldest contact on upgrade (their
  conversations, deals, notes, and tags are re-pointed, nothing is
  lost). Closes #212.
- **Configurable default deal currency.** Each account can now pick
  its default currency under **Settings → Deals** (admin+); the app
  previously hardcoded USD throughout. New deals default to it, and
  pipeline-stage totals, the dashboard "Open Deals Value" card, the
  pipeline-value donut, and automation-created deals all use it.
  Existing deals keep the currency they were saved with — totals are
  shown in the account default with no exchange-rate conversion (one
  currency per account). Full guide:
  [Default currency](https://wacrm.tech/docs/settings#deals).
- **Members tab in Settings.** The user-facing surface for the
  multi-user APIs below, available to everyone (no beta flag). From
  Settings → **Members** an admin or owner can: see who's on the
  account with their role and join date, invite teammates by
  generating a one-time share link (pick the role + optional
  expiry), revoke pending invites, change a member's role, remove a
  member, and — as owner — transfer ownership. Recipients accept via
  a public `/join/[token]` page. Full guide:
  [Members docs](https://wacrm.tech/docs/members).
- **Account & member management API** — server-side endpoints
  backing the Members tab. All routes are role-gated and
  return Supabase-RLS-scoped data.
  - `GET /api/account` — caller's account + role. Any member.
  - `PATCH /api/account` — rename the account. Admin+.
  - `GET /api/account/members` — list members. Email visible to
    admin+ only; agents/viewers see name + avatar + role +
    joined date.
  - `PATCH /api/account/members/[userId]` — change a member's
    role. Admin+. Owner promotion/demotion goes through the
    transfer endpoint instead.
  - `DELETE /api/account/members/[userId]` — remove a member.
    Admin+. The removed user keeps their login and is moved to a
    freshly-created personal account (mirror of the signup flow).
  - `POST /api/account/transfer-ownership` — owner only. Atomic
    swap with the named member.
- **Invitation API + redeem flow** — the no-email, link-only
  invite path that powers the Members tab's "Invite member" button
  and the `/join/[token]` accept page.
  - `GET /api/account/invitations` — list outstanding (admin+).
  - `POST /api/account/invitations` — create an invite, returns
    the plaintext token + share URL **exactly once** (we store
    only the SHA-256 hash on the row). Body
    `{ role, expiresInDays?, label? }`. Admin+.
  - `DELETE /api/account/invitations/[id]` — revoke (admin+).
  - `GET /api/invitations/[token]/peek` — public, per-IP
    rate-limited. Returns `{ ok, account_name, role, expires_at }`
    or `{ ok: false, reason }` so the join page can render
    "You're being invited to <Account> as <Role>".
  - `POST /api/invitations/[token]/redeem` — authenticated.
    Atomically moves the caller's profile to the inviter's
    account and cleans up the orphan personal account. Refuses
    with 409 if the caller's current account already contains
    domain data (no silent data loss).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/017_account_sharing.sql` — introduces the
  `accounts` and `account_invitations` tables plus an
  `account_role_enum` type; adds `account_id` to every
  user-scoped table and backfills it; rewrites every RLS policy;
  replaces the new-user trigger. Idempotent. **No data loss** —
  every existing user is mapped to a freshly-created account
  with role `owner` and every existing row of theirs is linked
  to that account.
- `supabase/migrations/018_account_member_rpcs.sql` — adds three
  `SECURITY DEFINER` RPCs (`set_member_role`,
  `remove_account_member`, `transfer_account_ownership`) that
  back the member-management API. They self-check the caller's
  role and raise SQLSTATE `42501` / `22023` on forbidden / bad
  input so the API layer can map cleanly to 403 / 400.
  Idempotent.
- `supabase/migrations/019_invitation_rpcs.sql` — adds two
  `SECURITY DEFINER` RPCs: `peek_invitation` (anonymous read by
  token hash, returns a fixed-shape JSON envelope) and
  `redeem_invitation` (authenticated atomic move + orphan
  cleanup, with a domain-data safety check). Both bypass the
  RLS that would otherwise block their reads/writes. Idempotent.
- `supabase/migrations/021_account_default_currency.sql` — adds
  `accounts.default_currency` (`TEXT NOT NULL DEFAULT 'USD'`, with a
  3-letter-code `CHECK`) backing the configurable default currency.
  Idempotent; existing accounts backfill to `USD`. **Apply before
  deploying** — the app now reads this column when loading the
  account, so an un-migrated database breaks account loading.
- `supabase/migrations/022_contact_phone_dedup.sql` — adds the
  generated `contacts.phone_normalized` column, **merges existing
  duplicate contacts into the oldest** (re-pointing conversations,
  deals, notes, tags, custom values, and broadcast recipients — no
  data loss), then adds a `UNIQUE (account_id, phone_normalized)`
  index. Idempotent. **Apply before deploying** — CSV import reads
  `phone_normalized`, and the index is what enforces de-duplication
  for every write path. The one-shot merge runs inside the migration.

## [0.2.2] — 2026-05-29

Flow nodes can now send media. Closes the most-requested gap from user
feedback after the v0.2.0 Flows launch — flows were text-only and
couldn't deliver an invoice, receipt, product photo, or short demo
video mid-conversation.

### Added

- **`send_media` flow node.** Send an image (PNG / JPEG / WebP), video
  (MP4 / 3GP), or document (PDF, Word, Excel, PowerPoint, TXT) to the
  customer from any point in a flow. Pick a file in the builder, it
  uploads to the new `flow-media` Supabase Storage bucket, and Meta
  fetches the public URL at send time. Optional caption (1024 char cap,
  supports `{{vars.X}}` interpolation); documents also take an optional
  filename shown in the recipient's chat. Auto-advances after send —
  same suspend semantics as `send_message`.
  ([#156](https://github.com/ArnasDon/wacrm/pull/156))

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/016_flow_media.sql` — does two things:
  1. Adds `'send_media'` to the `flow_nodes.node_type` CHECK
     constraint. Without this the `send_media` node fails to save with
     a constraint violation.
  2. Creates the public `flow-media` Supabase Storage bucket (16 MB
     file-size cap, image / video / document MIME allowlist) plus
     per-user RLS policies (path prefix = `auth.uid()`). Without this
     the builder's file picker fails on upload. Same shape as the
     `avatars` bucket from migration 008 — the bucket is **public** so
     Meta can fetch the URL without credentials.

The migration is idempotent and safe to re-run.

## [0.2.1] — 2026-05-26

Bug-fix release. Plugs a silent inbound-message drop that triggered
when two users on the same instance saved the same WhatsApp
`phone_number_id`.

### Fixed

- **Inbound WhatsApp messages no longer silently disappear** when two
  users have claimed the same `phone_number_id`. Previously the
  webhook used `.single()` to look up the owning config, which errors
  `PGRST116` for both 0 rows *and* ≥2 rows — the second user's save
  put the DB into the ≥2-row state and every inbound message was
  dropped while the log misleadingly reported *"No config found for
  phone_number_id"*. Three layers of fix: `POST /api/whatsapp/config`
  now returns **409** when another user has already claimed the
  number, the webhook lookup distinguishes 0 rows from ≥2 rows and
  logs the conflicting `user_id`s, and a new DB constraint
  (`UNIQUE(phone_number_id)`) prevents the bad state at the storage
  layer. Reported in
  [#136](https://github.com/ArnasDon/wacrm/issues/136), fixed in
  [#143](https://github.com/ArnasDon/wacrm/pull/143).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`
  — adds `UNIQUE(phone_number_id)` to `whatsapp_config`. **Fails
  loudly with a copy-pasteable resolution hint** if duplicate rows
  already exist; auto-deduping would destroy encrypted tokens, so
  the operator picks which row keeps the number. To check first:

  ```sql
  SELECT phone_number_id, array_agg(user_id) AS owners, count(*) AS n
  FROM whatsapp_config
  GROUP BY phone_number_id
  HAVING count(*) > 1;
  ```

  If that returns rows, `DELETE` the duplicate row(s) you want to
  drop, then re-run the migration.

### Note on multi-user setups

wacrm is intentionally **single-tenant per WhatsApp number**. RLS on
`conversations`/`messages` is `auth.uid() = user_id`, so a second
user physically cannot read messages routed to a different owner —
two users sharing one number was never supported. If you need
multiple humans handling the same inbox, run them under one shared
account.

## [0.2.0] — 2026-05-22

The **Flows** release. Adds a no-code, branching, button-driven WhatsApp
conversation engine that runs alongside Automations. Also ships a
5-theme color picker in Settings and opens Flows to all users.

### Added

#### Flows — branching chatbot conversations

- **Module + schema.** New `flows`, `flow_nodes`, `flow_runs`,
  `flow_run_events` tables with partial unique indexes that enforce
  one active run per contact. Widened `messages.content_type` CHECK
  to accept `'interactive'`; added `interactive_reply_id` column so
  the inbox can render button/list taps.
  ([#112](https://github.com/ArnasDon/wacrm/pull/112))
- **Runner engine.** `dispatchInboundToFlows` parses every inbound
  webhook, decides whether the message is a reply on an active run
  or a fresh trigger, advances the state machine, and reports back
  to the webhook so consumed messages don't also fire automations.
  Idempotent on Meta's `message_id`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))
- **No-code builder UI** at `/flows`. Linear-list editor with
  per-node config forms, live validator, draft/active/archived
  status, and a 5-route REST API (`GET/POST /api/flows`,
  `GET/PUT/DELETE /api/flows/[id]`, `POST /api/flows/[id]/activate`,
  `GET /api/flows/[id]/runs`, `GET /api/flows/templates`).
  ([#115](https://github.com/ArnasDon/wacrm/pull/115))
- **Templates + v1.5 node types.** Three starter templates
  (Welcome menu, FAQ bot, Lead capture) cloneable from the New-flow
  dialog. Three new node types: `collect_input` (capture customer
  text into a variable), `condition` (branch on var / tag / contact
  field), `set_tag` (add or remove a tag). `{{vars.X}}` interpolation
  in send_message + collect_input prompts. Per-flow run-history
  viewer at `/flows/[id]/runs`.
  ([#117](https://github.com/ArnasDon/wacrm/pull/117))
- **Stale-run sweep cron** at `GET /api/flows/cron` — marks runs
  past their configured timeout (default 24h) as `timed_out` so
  abandoned conversations free up the contact for new triggers.
  Reuses `AUTOMATION_CRON_SECRET`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))

#### Color themes

- **5 color themes** (Violet default, Emerald, Cobalt, Amber, Rose)
  selectable from a new **Appearance** tab in Settings. CSS variables
  scoped under `html[data-theme="..."]`, applied at runtime via
  `dataset.theme`, persisted to `localStorage`. Inline boot script in
  `layout.tsx` replays the choice before first paint so there's no
  flash of the default.
  ([#132](https://github.com/ArnasDon/wacrm/pull/132))
- **Theme tokenization sweep** — every previously hard-coded
  `violet-*` Tailwind class replaced with `primary` tokens across
  ~49 files. Picking a non-violet theme now themes the whole app,
  not just the chrome.
  ([#133](https://github.com/ArnasDon/wacrm/pull/133))

### Changed

#### Flows — soft-GA

- **Flows is now available to every authenticated user.** The
  per-account beta gate is gone; the sidebar entry + page header
  carry a small "Beta" chip as the only remaining signal.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))
- **Editor UX**:
  - Internal `node_key` + per-button/row `reply_id` identifiers
    hidden behind a per-node "Show advanced" disclosure.
    ([#118](https://github.com/ArnasDon/wacrm/pull/118))
  - `send_list` nodes can have multiple sections.
    ([#119](https://github.com/ArnasDon/wacrm/pull/119))
  - Collapsed node cards show a 1-line content preview per node
    type (text excerpt, button titles, condition summary, etc.).
    ([#120](https://github.com/ArnasDon/wacrm/pull/120))
  - Validation issues are clickable: jump to + flash the offending
    node.
    ([#121](https://github.com/ArnasDon/wacrm/pull/121))
  - Unsaved-changes "● Edited" indicator + `beforeunload` reload
    guard.
    ([#122](https://github.com/ArnasDon/wacrm/pull/122))
  - New-flow dialog actually widens to fit the 3 template cards
    (was capped at 384px by a baked-in `sm:max-w-sm` from shadcn).
    ([#129](https://github.com/ArnasDon/wacrm/pull/129),
    [#131](https://github.com/ArnasDon/wacrm/pull/131))
  - Validation panel pinned to the viewport bottom so
    activate-readiness follows the user as they scroll through nodes.
    ([#130](https://github.com/ArnasDon/wacrm/pull/130))

#### Engine reliability

- **Atomic `execution_count` increment** via SECURITY DEFINER RPC —
  prevents lost counts when two webhooks start runs concurrently.
  Mirrors the automations engine pattern.
  ([#124](https://github.com/ArnasDon/wacrm/pull/124))
- **Preload all flow_nodes once per dispatch** — one SELECT per
  inbound instead of one per advance-loop iteration. A 5-node
  auto-advance chain now costs 1 round trip, not 5.
  ([#125](https://github.com/ArnasDon/wacrm/pull/125))
- **Wasted re-read dropped** after reprompt reset; `loadActiveRun`
  switched to defensive `.limit(1)` so a migration glitch producing
  duplicates can't crash dispatch.
  ([#126](https://github.com/ArnasDon/wacrm/pull/126))

### Security

- **PII redacted from `reply_received` event payload** — customer
  text is no longer persisted to `flow_run_events.payload`; only
  the length is. A `collect_input` prompt asking "what's your card
  number?" used to leave the PAN sitting in the events table.
  ([#123](https://github.com/ArnasDon/wacrm/pull/123))
- **Constant-time cron-secret compare** on `/api/flows/cron`
  (`crypto.timingSafeEqual`) to close a theoretical
  timing-side-channel on the `x-cron-secret` header check.
  ([#127](https://github.com/ArnasDon/wacrm/pull/127))

### Fixed

- **`/flows` no longer spuriously redirects to `/dashboard`** when
  navigating in. Root cause: `useAuth` flipped `loading: false`
  before the profile fetch resolved. `use-auth` now exposes a
  separate `profileLoading` boolean.
  ([#128](https://github.com/ArnasDon/wacrm/pull/128))

### Migration required

Apply, in order, against your Supabase project:

1. `supabase/migrations/010_flows.sql` — Flows core tables, indexes,
   RLS policies, and the `messages` schema widening.
2. `supabase/migrations/011_profile_beta_features.sql` — adds the
   `profiles.beta_features` column. Surviving for future betas;
   Flows no longer reads it.
3. `supabase/migrations/012_flows_increment_counter.sql` — atomic
   counter RPC. Without this the engine still runs but
   `flows.execution_count` is racy.

Each migration is idempotent — safe to re-run if you're not sure
whether you applied a previous one.

### Removed

- **`src/lib/flows/feature-flag.ts`** + its tests. Flows is open to
  all users; the `profiles.beta_features` column itself survives
  for future beta gates.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))

---

## [0.1.1] — 2026-05-19

### Added

- Chat actions in the inbox: emoji reactions, reply-with-quote, and
  copy-text on individual messages. Hover on desktop, long-press on
  touch. Outbound reactions and replies forward to WhatsApp via the
  Cloud API; inbound reactions and swipe-replies from customers
  arrive through the webhook and appear in real time.

### Migration required

- Apply `supabase/migrations/009_message_actions.sql` to your
  Supabase project. It adds `messages.reply_to_message_id` and the
  new `message_reactions` table (with RLS and realtime). The
  migration is idempotent — safe to re-run.

### Changed

- The webhook no longer stores inbound customer reactions as fake
  text messages. They are written to `message_reactions` instead,
  so any custom queries that counted reactions as messages will
  need updating.

---

## [0.1.0]

Initial template release. Core CRM: inbox, contacts, pipelines,
broadcasts, automations (with a Wait-step cron drain), WhatsApp
Cloud API integration, Supabase auth + RLS.
