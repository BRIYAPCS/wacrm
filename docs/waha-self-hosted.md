# WAHA — self-hosted WhatsApp gateway

[WAHA](https://waha.devlike.pro) is a self-hosted WhatsApp HTTP API. wacrm can
use it as a WhatsApp **provider** alongside Meta, Twilio and wsapi.chat. Because
you run the gateway yourself, there are no per-message fees and no third party —
but you operate the server.

Like the other QR providers, WAHA is **provider-blind** to tenants: a customer
just scans a QR to link their number and never learns which gateway is behind
it. Provisioning is superadmin-only.

## How it fits together

```
customer's phone ──scans QR──► WAHA session ──webhook──► /api/waha/webhook ──► inbox
        app (send) ──► POST /api/sendText ──► WAHA ──► WhatsApp
```

Each connected number = one WAHA **session**. The WAHA server (base URL + API
key) is **platform infrastructure** shared by every session and configured via
env — never stored per-tenant. Only each session's name lives in the
`whatsapp_config` row.

## 1. Run the WAHA server

Any Docker host works (a small 2 GB VPS is plenty for the GOWS engine). GOWS is
free in WAHA **Core** and supports multiple sessions.

Generate an API key and store only its **sha512** on the server, so the
plaintext lives only in the app's env:

```bash
KEY="waha_$(openssl rand -hex 24)"                 # give this to the app (WAHA_API_KEY)
HASH="sha512:$(printf %s "$KEY" | openssl dgst -sha512 | awk '{print $2}')"
echo "app WAHA_API_KEY=$KEY"

docker run -d --name waha --restart always \
  -p 3000:3000 \
  -e WHATSAPP_DEFAULT_ENGINE=GOWS \
  -e WAHA_API_KEY="$HASH" \
  -e WHATSAPP_RESTART_ALL_SESSIONS=true \
  -e WAHA_DASHBOARD_ENABLED=true \
  -e WAHA_DASHBOARD_USERNAME=admin \
  -e WAHA_DASHBOARD_PASSWORD="$(openssl rand -base64 18)" \
  -e WHATSAPP_SWAGGER_ENABLED=false \
  -v /root/waha/sessions:/app/.sessions \
  devlikeapro/waha
```

- `WHATSAPP_RESTART_ALL_SESSIONS=true` re-links paired numbers after a reboot.
- The `.sessions` volume persists pairings — **back it up**.
- `--restart always` keeps it up across reboots.

> **TLS in production.** The example serves plain HTTP on `:3000`. That's fine
> for a first test, but for production put WAHA behind HTTPS (a reverse proxy
> with a real cert, or a Cloudflare Tunnel) and point `WAHA_BASE_URL` at the
> `https://` URL — the API key and QR images otherwise travel in the clear.

## 2. Configure the app

Set these in the app's environment (see `.env.local.example`):

| Variable | Purpose |
|---|---|
| `WAHA_BASE_URL` | The WAHA server, e.g. `https://waha.example.com` (no trailing `/`) |
| `WAHA_API_KEY` | The **plaintext** key (server holds only its sha512) |
| `WAHA_WEBHOOK_HMAC_KEY` | Shared secret WAHA signs inbound webhooks with |
| `WAHA_WEBHOOK_URL` | *(optional)* the app's public base URL for WAHA to POST to. Auto-derived from the request host when unset — set it explicitly if the app sits behind a proxy that rewrites the host. |

Apply the migration:

```bash
npm run db:deploy   # applies 055_whatsapp_waha.sql
```

## 3. Provision a number (superadmin)

1. Open `/superadmin` → the account → **WhatsApp**.
2. Choose provider **WAHA (self-hosted)**, give it a **label**, **Add number**.
   No credentials are pasted — the app creates a session on the WAHA server and
   wires its inbound webhook (to `${WAHA_WEBHOOK_URL}/api/waha/webhook`) with the
   HMAC key automatically.
3. The tenant opens **Settings → WhatsApp → Link your number** and scans the QR
   with WhatsApp → *Linked devices → Link a device*. Status flips to
   **Connected** once paired (the app also gets a live `session.status` webhook).

## Capabilities & limits

- **Send:** text and image (with caption). Templates require a Meta number.
- **Receive:** inbound text is ingested; group messages and our own echoes are
  ignored.
- **Profiles:** the customer's photo/about are fetched best-effort after their
  first message (same as wsapi.chat).
- Numbers count against the account's `whatsapp_numbers` plan limit.

## Troubleshooting

- **"WAHA server is not configured"** on provision → `WAHA_BASE_URL` /
  `WAHA_API_KEY` aren't set in the app env.
- **QR never appears** → check the app can reach `WAHA_BASE_URL` and that the
  session is `SCAN_QR_CODE` (WAHA dashboard at `:3000/dashboard`).
- **Paired but no inbound** → WAHA can't reach `WAHA_WEBHOOK_URL`; confirm it's
  public (a tunnel URL during local testing) and matches what the session was
  created with. Re-provisioning re-points the webhook.
- **401 on the webhook** → `WAHA_WEBHOOK_HMAC_KEY` in the app doesn't match the
  key the session was created with; re-provision the number.
