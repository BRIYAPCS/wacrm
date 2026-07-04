import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Authenticate a scheduled-cron request against `AUTOMATION_CRON_SECRET`.
 *
 * The maintenance endpoints (`/api/automations/cron`, `/api/flows/cron`)
 * are public URLs, so they gate on a shared secret. This is the single
 * source of truth for that check — accepting the secret two ways so any
 * scheduler works with the same server config:
 *
 *   - `x-cron-secret: <secret>`        — curl, Hostinger cron, GitHub
 *                                         Actions, any custom pinger.
 *   - `Authorization: Bearer <secret>` — Vercel Cron (set the project's
 *                                         `CRON_SECRET` env to the same
 *                                         value; Vercel sends this header).
 *
 * Comparison is constant-time so an attacker who can hit the endpoint
 * can't recover the secret byte-by-byte from response-time deltas. The
 * length pre-check is required by `timingSafeEqual` (it throws on a
 * length mismatch) and leaks only the length, which isn't sensitive.
 *
 * Returns a `NextResponse` for the caller to short-circuit with —
 * `503` when the secret isn't configured on the server, `401` on a
 * missing/wrong secret — or `null` when the request is authorized and
 * the route should proceed.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const raw =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization") ??
    "";
  const supplied = raw.replace(/^Bearer\s+/i, "");

  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
