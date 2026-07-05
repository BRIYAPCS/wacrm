// ============================================================
// POST /api/waha/sync — import the connected WAHA number's existing chats +
// full message history into the inbox. Admin/owner only. Runs in the
// background (after the response); inserts stream into the DB, so the inbox's
// realtime subscription fills in live while it runs.
// ============================================================

import { NextResponse, after } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wahaBaseUrl } from "@/lib/waha/config";
import { syncWahaHistory } from "@/lib/waha/sync";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST() {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`wahaSync:${ctx.accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data: config } = await admin
      .from("whatsapp_config")
      .select("id, user_id, base_url, access_token, waha_session, status")
      .eq("account_id", ctx.accountId)
      .eq("provider", "waha")
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!config?.waha_session) {
      return NextResponse.json(
        { error: "No WAHA number is connected on this account." },
        { status: 400 },
      );
    }

    const creds = {
      baseUrl: wahaBaseUrl(config.base_url),
      apiKey: decrypt(config.access_token),
      session: config.waha_session as string,
    };
    const cfg = {
      accountId: ctx.accountId,
      ownerUserId: (config.user_id as string) ?? ctx.userId,
      configId: config.id as string,
    };

    // Fire-and-forget: the import can take a while for a busy number. Inserts
    // land in the DB as it goes, so the inbox fills in via realtime.
    after(async () => {
      try {
        await syncWahaHistory(admin, cfg, creds);
      } catch (err) {
        console.error("[waha sync] failed:", err);
      }
    });

    return NextResponse.json({ started: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
