# New-customer redeploy checklist

A tight, copy-paste runbook for standing up wacrm for **a new customer**.
Each customer is a fully isolated instance: its own Supabase project, its
own domain, its own WhatsApp number, its own data. Nothing is shared.

For the *why* behind each step, see **[DEPLOYMENT.md](../DEPLOYMENT.md)**.
Budget ~20 minutes once you've done it before.

---

## Per-customer facts to collect first

- [ ] Customer name / slug (e.g. `acme`)
- [ ] Domain for the CRM (e.g. `crm.acme.com`)
- [ ] WhatsApp: `phone_number_id`, WABA id, permanent access token
- [ ] SMTP provider credentials (or reuse a shared sender domain)

---

## 1. Code

```bash
git clone https://github.com/<your-org>/wacrm.git customer-acme
cd customer-acme
npm install
npm run setup          # creates .env, generates ENCRYPTION_KEY + cron secret
```

- [ ] `npm run setup` ran — note it generated a **fresh `ENCRYPTION_KEY`**
      (unique per customer; never reuse or rotate it).

## 2. Supabase project (new, per customer)

- [ ] Create a new Supabase project; save the DB password.
- [ ] Copy into `.env`: `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Copy the **Session pooler** URI (port `5432`) → `SUPABASE_DB_URL`
      (paste the DB password in).
- [ ] `npm run setup` again → all required values show green.

## 3. Schema

```bash
npm run db:deploy
```

- [ ] Ends with `✓ Database up to date`.

## 4. Supabase Auth (SMTP + URLs)

- [ ] **Auth → SMTP Settings** → enable Custom SMTP (host/port/user/pass +
      verified sender). *Invites won't send without this.*
- [ ] **Auth → URL Configuration** → **Site URL** = the customer domain;
      **Redirect URLs** include `https://crm.acme.com/**`.

## 5. Deploy the app

- [ ] Deploy (Hostinger / Vercel / VPS) with **all `.env` vars** set in the
      host dashboard.
- [ ] `NEXT_PUBLIC_SITE_URL` = the customer domain.
- [ ] App loads over HTTPS; `/login` renders.

## 6. WhatsApp

- [ ] `META_APP_SECRET` set (Meta → App Settings → Basic).
- [ ] App **Settings → WhatsApp** → enter number/WABA/token + a verify
      token → **Connected**, probe green.
- [ ] Meta → Webhook: Callback `https://crm.acme.com/api/whatsapp/webhook`,
      same verify token, subscribe **messages**.

## 7. Cron (GitHub Actions)

Repo → **Settings → Secrets and variables → Actions**:

- [ ] Variable `BASE_URL` = `https://crm.acme.com`
- [ ] Secret `CRON_SECRET` = the `.env` `AUTOMATION_CRON_SECRET`
- [ ] Actions → "Scheduled cron" → **Run workflow** → green.

## 8. Hand-off

- [ ] First sign-up at the domain → **owner** account (do this, or have the
      customer admin do it).
- [ ] Send a **test invite** to a second email → `/accept-invite` completes.
- [ ] Send a WhatsApp message **to** the number → shows in the inbox; reply
      back works.
- [ ] Give the customer admin their login; they invite the rest of the team
      (Settings → Team members).
- [ ] _(Optional)_ AI assistant is self-serve, **per account** — the admin
      adds their own provider key + knowledge base under **Settings → AI**.
      Nothing to set at deploy time. See
      [ai-assistant.md](./ai-assistant.md).

---

## Isolation notes (safe to reuse the code, never the secrets)

Reuse per customer | Never reuse across customers
---|---
The repo / codebase | `ENCRYPTION_KEY`
Your SMTP provider account | Supabase project (+ its keys + `SUPABASE_DB_URL`)
The GitHub Actions workflow file | WhatsApp number / access token
CI config | `AUTOMATION_CRON_SECRET`, domain, `META_APP_SECRET`

> **Escape hatch (no lockout):** to temporarily re-open public sign-up on
> any instance — `UPDATE app_settings SET public_signup_enabled = true;`
> plus `NEXT_PUBLIC_ALLOW_SIGNUP=true`. Set both back to re-lock.
