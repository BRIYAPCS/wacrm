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

A 5-minute interval is plenty (Flow timeouts default to 24h). Pick
whichever scheduler fits your host. Each hits both routes with the
secret header. This repo ships [`scripts/cron-ping.sh`](../scripts/cron-ping.sh)
that does both in one call.

### Option A — Hostinger scheduled task (recommended for this stack)

hPanel → **Advanced → Cron Jobs → Create**:

- **Command type:** custom
- **Interval:** every 5 minutes (`*/5 * * * *`)
- **Command:**
  ```bash
  BASE_URL=https://your-domain.com AUTOMATION_CRON_SECRET=your-secret /path/to/wacrm/scripts/cron-ping.sh
  ```

### Option B — plain crontab (any Linux VPS)

```cron
*/5 * * * * BASE_URL=https://your-domain.com AUTOMATION_CRON_SECRET=your-secret /path/to/wacrm/scripts/cron-ping.sh >> /var/log/wacrm-cron.log 2>&1
```

Or inline without the script:

```cron
*/5 * * * * curl -sS -H "x-cron-secret: your-secret" https://your-domain.com/api/automations/cron
*/5 * * * * curl -sS -H "x-cron-secret: your-secret" https://your-domain.com/api/flows/cron
```

### Option C — GitHub Actions (no server needed)

`.github/workflows/cron.yml` in your fork (store the secret as a repo
secret `CRON_SECRET`):

```yaml
name: wacrm-cron
on:
  schedule:
    - cron: "*/5 * * * *"   # GitHub's minimum granularity is ~5 min
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" https://your-domain.com/api/automations/cron
          curl -sS -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" https://your-domain.com/api/flows/cron
```

### Option D — Vercel Cron

If you deploy to Vercel, add `vercel.json`. Vercel injects its own auth;
to keep the shared-secret check, front it with a tiny wrapper route, or
set `AUTOMATION_CRON_SECRET` and use an external pinger (A–C) instead —
Vercel Cron can't set a custom request header.

## 3. Verify it works

```bash
curl -i -H "x-cron-secret: your-secret" https://your-domain.com/api/automations/cron
# 200 {"processed":0}   ← working (0 just means nothing was due)
# 401                    ← secret mismatch
# 503                    ← AUTOMATION_CRON_SECRET not set on the server
```
