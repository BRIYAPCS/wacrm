// ============================================================
// PATCH /api/inbox/background  (admin+)
//
// Set (or clear) the account-wide default chat background. Owner/admin
// only. Handled server-side (rather than a direct client write) so token
// validation and orphaned-image cleanup live in one place.
//
// Body: { background: string | null }
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isValidBackground, parseBackground } from "@/lib/inbox/backgrounds";
import { deleteOrphanedBackgroundImage } from "@/lib/inbox/background-cleanup";

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `inbox:bg:account:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

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
      return NextResponse.json({ error: "Invalid background value" }, { status: 400 });
    }

    const parsed = parseBackground(value);
    if (parsed.kind === "image" && !parsed.path.startsWith(`account-${ctx.accountId}/`)) {
      return NextResponse.json(
        { error: "Background image does not belong to this account" },
        { status: 400 },
      );
    }

    const next = value === "" ? null : value;

    // Read the outgoing value first so we can GC it if it was an image.
    const { data: before } = await ctx.supabase
      .from("accounts")
      .select("inbox_background")
      .eq("id", ctx.accountId)
      .maybeSingle();

    const { error } = await ctx.supabase
      .from("accounts")
      .update({ inbox_background: next })
      .eq("id", ctx.accountId);

    if (error) {
      console.error("[inbox/background PATCH] update error:", error);
      return NextResponse.json(
        { error: "Failed to update background" },
        { status: 500 },
      );
    }

    await deleteOrphanedBackgroundImage(
      ctx.supabase,
      ctx.accountId,
      before?.inbox_background ?? null,
      next,
    );

    return NextResponse.json({ success: true, background: next });
  } catch (err) {
    return toErrorResponse(err);
  }
}
