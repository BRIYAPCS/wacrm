# Testing with WSAPI (wsapi.chat)

A self-contained bridge to test wacrm against **WSAPI** — an open-source
WhatsApp gateway — instead of the Meta Cloud API. It's **inert unless
`WSAPI_ENABLED=true`** and never touches the Meta path.

> ⚠️ The API key you paste anywhere is a live credential. When you're done
> testing, click **Rotate API Key** in the WSAPI instance's Settings tab.

## 1. Configure (already done for your dev instance)

`.env` (gitignored) has:

```
WSAPI_ENABLED=true
WSAPI_BASE_URL=https://api.wsapi.chat
WSAPI_API_KEY=sk_...
WSAPI_INSTANCE_ID=ins_...
# WSAPI_WEBHOOK_SECRET=   (optional signing secret)
# WSAPI_ACCOUNT_ID=       (auto when there's one account)
```

**Restart `npm run dev`** after changing env — Next.js reads it at boot.

## 2. Outbound — send a WhatsApp from wacrm

As an admin, POST to the test route:

```bash
curl -X POST http://localhost:3000/api/wsapi/test-send \
  -H "Content-Type: application/json" \
  --cookie "<your browser session cookie>" \
  -d '{"to":"12408017036","message":"hello from wacrm"}'
```

(Phone with country code, no `+`. Verified working — returns a message id.)

> API-field note: WSAPI's send-text field is **`text`**, not `message` as
> the quickstart doc shows. The client already sends the correct field.

## 3. Inbound — see real messages land in the inbox

WSAPI must reach your local server, so expose it with a tunnel (you already
use Cloudflare):

```bash
cloudflared tunnel --url http://localhost:3000
```

1. Copy the public `https://…trycloudflare.com` URL.
2. In WSAPI → your instance → **event delivery / webhook**, set the URL to
   **`https://<tunnel>/api/wsapi/webhook`** and choose the `message` event.
   (If you set a signing secret, also put it in `WSAPI_WEBHOOK_SECRET` and
   restart.)
3. From another phone, **send a WhatsApp to your connected number**
   (+1 240 801 7036).
4. Watch the wacrm **Inbox** — a conversation + contact appear, unread
   badge bumps, in real time.

The webhook **logs the raw event** to the server console on each message, so
you can confirm the exact payload shape (WSAPI is Baileys-based; the parser
handles the common `key.remoteJid` / `message.conversation` /
`extendedTextMessage` shapes).

## Production flow: add numbers in the UI (migration 051)

The env vars above are just a quick test bridge. The real, multi-number
flow lives in **Settings → WhatsApp → "Add number via wsapi.chat"**:

1. Create an instance per number in your wsapi.chat dashboard.
2. In wacrm, click **Add number via wsapi.chat**, paste the **Instance ID**
   + **API key**, and (if not already paired) **scan the QR** shown in the
   dialog. Status polls until connected.
3. Set that instance's webhook (in wsapi.chat) to the URL shown in the
   dialog: `https://<your-domain>/api/wsapi/webhook`.

Each connected number is a `whatsapp_config` row with `provider='wsapi'`
(the API key is encrypted). It counts against your plan's
`whatsapp_numbers` limit alongside Meta numbers. Inbound is routed to the
right account by the `X-Instance-Id` header; **replies from the inbox
composer go back out through that number's WSAPI instance** automatically.

So the inbox is **fully two-way** on wsapi.chat, and you can mix Meta and
wsapi.chat numbers in one account.

## Files

- `src/lib/wsapi/{config,client,management,ingest}.ts`
- `src/app/api/wsapi/webhook/route.ts` (receive, routes by instance)
- `src/app/api/whatsapp/wsapi/*` (connect / status / QR / remove)
- `src/components/settings/wsapi-connect.tsx` (the QR onboarding UI)
- `src/lib/whatsapp/send-message.ts` (per-row provider routing)
