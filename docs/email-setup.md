# Email deliverability (custom SMTP)

wacrm sends transactional email through **Supabase Auth**:

- **Team invitations** (`Settings → Team members → Invite`) — the primary
  way members join. Sign-up is invite-only, so **without working email you
  cannot add teammates.**
- **Password reset** (`/forgot-password`)
- **Email confirmation / magic links** (if you enable them)

> Because onboarding is invite-only and invites are emailed, **custom SMTP
> is effectively required**, not optional — set it up before handing an
> instance to a customer. Also make sure your domain is in Supabase's
> **Auth → URL Configuration → Redirect URLs** (a `https://your-domain/**`
> wildcard) so the emailed `/accept-invite` link is trusted.

## Why you need custom SMTP for production

Supabase's **built-in email** is meant for development only. It has a
hard, low rate limit (a handful of messages per hour, shared, subject to
change) and sends from a generic Supabase address that lands in spam.
For real users you must plug in your own SMTP provider — then password
resets are reliable and come from your own domain.

> This is a **Supabase dashboard setting**, not app code — there's no env
> var in this repo for it, and it needs your SMTP provider's credentials.
> So it can't be scripted from here; follow the steps below once.

## Pick a provider

Any SMTP provider works. Common choices with generous free tiers:

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** | 3k/mo | Simple, developer-friendly, fast domain setup |
| **Postmark** | 100/mo trial | Best-in-class deliverability for transactional |
| **SendGrid** | 100/day | Ubiquitous |
| **AWS SES** | 62k/mo (from EC2) | Cheapest at scale, more setup |

You'll need: **SMTP host, port, username, password**, and a **verified
sender domain** (add the provider's SPF/DKIM DNS records — this is what
keeps you out of spam).

## Configure it in Supabase

1. Supabase Dashboard → **Project Settings → Authentication → SMTP Settings**
   (also reachable under **Authentication → Emails → SMTP**).
2. Toggle **Enable Custom SMTP** and fill in:
   - **Sender email** — e.g. `no-reply@your-domain.com` (must be on the
     domain you verified with the provider)
   - **Sender name** — e.g. `Your CRM`
   - **Host** / **Port** — from your provider (commonly `587` STARTTLS)
   - **Username** / **Password** — the provider's SMTP credentials
3. **Save.**
4. (Recommended) **Authentication → Rate Limits** — raise the email rate
   limit now that you're off the shared built-in sender.
5. (Optional) **Authentication → Emails → Templates** — brand the reset
   email. Keep the `{{ .ConfirmationURL }}` token intact.

## Verify

Go to `/forgot-password` on your deployment, submit your address, and
confirm the email arrives from your domain (check spam the first time —
if it's flagged, your SPF/DKIM records aren't fully propagated yet).

## Set the reset-link origin

Password-reset links point back at your app. Make sure, in production:

- `NEXT_PUBLIC_SITE_URL` is your real domain (see `.env`), and
- Supabase → **Authentication → URL Configuration → Site URL** and
  **Redirect URLs** include your domain (e.g. `https://your-domain.com/**`).

Otherwise the link in the email may point at `localhost` or be rejected
as an untrusted redirect.
