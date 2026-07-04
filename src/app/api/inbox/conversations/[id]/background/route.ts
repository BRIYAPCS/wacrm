// ============================================================
// PATCH /api/inbox/conversations/[id]/background  (admin+)
//
// Set (or clear) a single conversation's chat-background override.
// Owner/admin only — changing a thread's wallpaper is an admin act, and
// the shared `conversations` UPDATE RLS is only agent+, so the role gate
// is enforced here rather than in the database.
//
// Body: { background: string | null }
//   - a valid token (see src/lib/inbox/backgrounds.ts), or
//   - null / '' to clear the override (fall back to the account default)
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isValidBackground, parseBackground } from "@/lib/inbox/backgrounds";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `inbox:bg:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { background?: unknown }
      | null;
    const raw = body?.background;

    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "'background' must be a string or null" },
        { status: 400 },
      );
    }

    const value = typeof raw === "string" ? raw.trim() : "";
    if (!isValidBackground(value)) {
      return NextResponse.json(
        { error: "Invalid background value" },
        { status: 400 },
      );
    }

    // An uploaded wallpaper must live under the caller's own account
    // folder — defence in depth against pointing a thread at another
    // account's object path.
    const parsed = parseBackground(value);
    if (parsed.kind === "image" && !parsed.path.startsWith(`account-${ctx.accountId}/`)) {
      return NextResponse.json(
        { error: "Background image does not belong to this account" },
        { status: 400 },
      );
    }

    const next = value === "" ? null : value;

    const { data, error } = await ctx.supabase
      .from("conversations")
      .update({ background: next })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[inbox/background PATCH] update error:", error);
      return NextResponse.json(
        { error: "Failed to update background" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, background: next });
  } catch (err) {
    return toErrorResponse(err);
  }
}
