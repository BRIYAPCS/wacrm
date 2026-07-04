// ============================================================
// /api/account/business-hours
//   GET   — timezone, weekly schedule, and away auto-reply config.
//           Any member.
//   PATCH — update any of the above.  Admin+.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  coerceBusinessHours,
  DEFAULT_BUSINESS_HOURS,
  DAY_LABELS,
  type BusinessHours,
  type DayKey,
} from "@/lib/business-hours";

const AWAY_MSG_MAX = 1000;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const HHMM = /^(\d{1,2}):(\d{2})$/;
function minutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) return -1;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return -1;
  return h * 60 + mm;
}

/** Returns an error string, or null if the (already-coerced) schedule is valid. */
function validateHours(bh: BusinessHours): string | null {
  for (const key of Object.keys(bh) as DayKey[]) {
    const d = bh[key];
    if (!d.enabled) continue;
    const o = minutes(d.open);
    const c = minutes(d.close);
    if (o < 0 || c < 0) return `${DAY_LABELS[key]} has an invalid time.`;
    if (c <= o) return `${DAY_LABELS[key]}: closing time must be after opening time.`;
  }
  return null;
}

async function readConfig(supabase: Awaited<ReturnType<typeof getCurrentAccount>>["supabase"], accountId: string) {
  const { data } = await supabase
    .from("accounts")
    .select("timezone, business_hours, away_auto_reply_enabled, away_message")
    .eq("id", accountId)
    .maybeSingle();
  return {
    timezone: data?.timezone ?? "UTC",
    business_hours: coerceBusinessHours(data?.business_hours),
    away_auto_reply_enabled: data?.away_auto_reply_enabled ?? false,
    away_message: data?.away_message ?? "",
  };
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json(await readConfig(ctx.supabase, ctx.accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`bizHours:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          timezone?: unknown;
          business_hours?: unknown;
          away_auto_reply_enabled?: unknown;
          away_message?: unknown;
        }
      | null;

    const update: Record<string, unknown> = {};

    if (typeof body?.timezone === "string") {
      if (!isValidTimezone(body.timezone)) {
        return NextResponse.json({ error: "Unknown timezone." }, { status: 400 });
      }
      update.timezone = body.timezone;
    }

    if (body?.business_hours !== undefined) {
      const coerced = coerceBusinessHours(body.business_hours ?? DEFAULT_BUSINESS_HOURS);
      const err = validateHours(coerced);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      update.business_hours = coerced;
    }

    if (typeof body?.away_auto_reply_enabled === "boolean") {
      update.away_auto_reply_enabled = body.away_auto_reply_enabled;
    }

    if (typeof body?.away_message === "string") {
      if (body.away_message.length > AWAY_MSG_MAX) {
        return NextResponse.json(
          { error: `Away message must be ${AWAY_MSG_MAX} characters or fewer.` },
          { status: 400 },
        );
      }
      update.away_message = body.away_message;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await ctx.supabase
        .from("accounts")
        .update(update)
        .eq("id", ctx.accountId);
      if (error) {
        console.error("[PATCH business-hours]", error);
        return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
    }

    return NextResponse.json(await readConfig(ctx.supabase, ctx.accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}
