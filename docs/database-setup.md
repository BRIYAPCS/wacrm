# Automated database setup

wacrm runs on **Supabase** (Postgres + Auth + Storage + Realtime + RLS).
The app's whole data layer — every table's row-level security, the
storage buckets for media, the realtime inbox, the signup→profile
trigger — is defined in the SQL migrations under
[`supabase/migrations/`](../supabase/migrations). This repo ships a
one-command deployer that applies them all to your Supabase project.

> **Why not Neon / plain Postgres?** The schema depends on Supabase's
> `auth`, `storage`, and `realtime` schemas and on RLS driven by
> `auth.uid()`. A bare Postgres host (Neon, RDS, etc.) has none of
> those, so it can't run this schema without a substantial rewrite of
> auth, storage, and realtime. Stay on Supabase.

## One-time setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com) → **New project**. You already
have one if `NEXT_PUBLIC_SUPABASE_URL` in your `.env` is filled in.

### 2. Put the three keys in `.env`

From **Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Plus `ENCRYPTION_KEY` (generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

### 3. Add the database connection string

The service-role key can run queries but **not** schema changes (DDL).
Applying migrations needs a real Postgres connection, so add one more
line to `.env`:

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<YOUR-DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Get it from **Supabase Dashboard → Connect → Session pooler → URI**,
then paste your database password where the URI shows `[YOUR-PASSWORD]`.

> Use the **Session pooler** (port `5432`). The Transaction pooler
> (`6543`) doesn't support the DDL these migrations run.

### 4. Deploy the schema

```bash
npm install
npm run db:deploy
```

You'll see each migration applied in order:

```
→ Connecting to database…
  ▶  001_initial_schema.sql … done
  ▶  002_pipelines_enhancements.sql … done
  …
✓ Database up to date — 30 migration(s) applied, 0 already present.
```

That's the entire database: all tables, RLS policies, the `avatars` /
`chat-media` / `flow-media` storage buckets, functions, triggers, and
the realtime publication.

## Re-running

`npm run db:deploy` is **safe to run any time**. Every migration is
idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS`), and the script
records applied versions in a `wacrm_schema_migrations` table, so
already-applied files are skipped. When you pull new migrations later,
just run it again — only the new ones apply.

## Then run the app

```bash
npm run dev      # http://localhost:3000
```

Sign up at `/login` — the **first user on a fresh instance becomes the
owner** (sign-up is invite-only thereafter; the trigger creates the
account + owner profile automatically). Everything except **inbound
WhatsApp webhooks** works immediately. Those need Meta credentials
(`META_APP_SECRET`, WhatsApp settings) which you can add later; nothing
else is blocked by them.

> Adding teammates is by **email invitation** (Settings → Team members),
> which needs SMTP configured in your Supabase project — see
> [email-setup.md](./email-setup.md) and
> [../DEPLOYMENT.md](../DEPLOYMENT.md) Step 4.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SUPABASE_DB_URL is not set` | Add it to `.env` (step 3). |
| `password authentication failed` | Wrong DB password in the URI. Reset it under Dashboard → Database → Settings if unsure. |
| `SASL` / TLS / timeout errors | You're likely on the Transaction pooler (`6543`). Switch to the Session pooler (`5432`). |
| `permission denied for schema storage` | Make sure the URI user is `postgres` (the default in the pooler URI), not a restricted role. |
