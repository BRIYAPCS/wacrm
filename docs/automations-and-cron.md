# Automations, Flows & the cron pinger

Two features rely on a **scheduled ping** to advance work that isn't
triggered by a live inbound message:

- **Automation "Wait" steps** — a Wait pauses an automation for N
  minutes/hours; a pending row is stored and later resumed by
  `GET /api/automations/cron`.
- **Flow fallbacks / timeouts** — an abandoned flow run is swept and
  marked `timed_out` by `GET /api/flows/cron`, freeing the customer for
  new triggers. (This one is **not optional** if you use Flows — without
  it, a customer who drops out of a flow can be blocked from re-entering
  it.)

If you use neither Wait steps nor Flows, you can skip this entirely.

## 1. Set the shared secret

Both endpoints require the `AUTOMATION_CRON_SECRET` env var and reject
any request whose `x-cron-secret` header doesn't match it (constant-time
compare). Generate one and set it wherever your app's env lives:

```bash
openssl rand -hex 32
# or:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
AUTOMATION_CRON_SECRET=<the generated value>
```

> Already set in your local `.env`. In production, add the **same value**
> to your host's env (Hostinger hPanel → Environment, Vercel → Settings →
> Environment Variables, etc.). If it's unset, both endpoints return
> `503 cron not configured` and Wait/Flow timeouts silently never fire.

## 2. Schedule the ping (every ~5 minutes)

A 5-minute interval is plenty (Flow timeouts default to 24h). **Pick ONE**
of the options below — running two schedulers just double-fires (harmless,
since each call is idempotent, but wasteful).

Both endpoints accept the secret two ways, so any scheduler works:

- `x-cron-secret: <secret>` — curl, cron, GitHub Actions
- `Authorization: Bearer <secret>` — Vercel Cron

### Option A — GitHub Actions (recommended; already in the repo)

This repo ships [`.github/workflows/cron.yml`](../.github/workflows/cron.yml) —
a scheduled workflow that runs in GitHub's cloud and pings both endpoints
every 5 minutes. It's **host-agnostic** (works on Hostinger, Vercel,
Railway, a VPS) and needs no server-side cron.

One-time setup **after you deploy** — repo → **Settings → Secrets and
variables → Actions**:

- **Variable** `BASE_URL` = `https://your-domain.com` (no trailing slash)
- **Secret** `CRON_SECRET` = the same value as the app's `AUTOMATION_CRON_SECRET`

Until `BASE_URL` is set the job no-ops (it won't fail red before launch).
Scheduled workflows run only from the **default branch** and GitHub may
delay them under load — fine for Wait steps and the 24h flow-timeout
default. Trigger it manually anytime via **Actions → Scheduled cron → Run
workflow**.

### Option B — Vercel Cron (if you deploy on Vercel)

Add `vercel.json` and set the project's `CRON_SECRET` env var to your
`AUTOMATION_CRON_SECRET` — Vercel automatically sends
`Authorization: Bearer $CRON_SECRET`, which the endpoints now accept.

```json
{
  "crons": [
    { "path": "/api/automations/cron", "schedule": "*/5 * * * *" },
    { "path": "/api/flows/cron", "schedule": "*/5 * * * *" }
  ]
}
```

> Minute-level schedules need a **Vercel Pro** plan (Hobby caps crons at
> once/day). On Hobby, use Option A instead. If you use Vercel Cron,
> delete `.github/workflows/cron.yml` so they don't double-fire.

### Option C — Hostinger scheduled task / any Linux crontab

Uses the bundled [`scripts/cron-ping.sh`](../scripts/cron-ping.sh) (hits
both routes in one call). In hPanel → **Advanced → Cron Jobs → Create**
(or a plain crontab), every 5 minutes:

```cron
*/5 * * * * BASE_URL=https://your-domain.com AUTOMATION_CRON_SECRET=your-secret /path/to/wacrm/scripts/cron-ping.sh >> /var/log/wacrm-cron.log 2>&1
```

Delete `.github/workflows/cron.yml` if you go this route (avoid
double-firing).

## 3. Verify it works

```bash
curl -i -H "x-cron-secret: your-secret" https://your-domain.com/api/automations/cron
# 200 {"processed":0}   ← working (0 just means nothing was due)
# 401                    ← secret mismatch
# 503                    ← AUTOMATION_CRON_SECRET not set on the server

# Vercel-style auth works too:
curl -i -H "Authorization: Bearer your-secret" https://your-domain.com/api/flows/cron
```
