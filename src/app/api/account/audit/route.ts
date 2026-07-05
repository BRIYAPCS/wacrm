// ============================================================
// GET /api/account/audit?limit=&before=
//
// Admin+. Returns the account's audit log, newest first. Cursor
// pagination via `before` (an ISO created_at from the last row of the
// previous page) powers "Load more". RLS on audit_logs also enforces the
// admin+ scope, so this is defense-in-depth on top of requireRole.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, requireFeature, toErrorResponse } from "@/lib/auth/account";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    requireFeature(ctx, "audit_log", "The audit log");

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
      : DEFAULT_LIMIT;
    const before = url.searchParams.get("before");

    let query = ctx.supabase
      .from("audit_logs")
      .select(
        "id, actor_user_id, actor_label, action, entity_type, entity_id, metadata, created_at",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      // +1 so we can tell the client whether another page exists.
      .limit(limit + 1);

    if (before) query = query.lt("created_at", before);

    const { data, error } = await query;
    if (error) {
      console.error("[GET /api/account/audit]", error);
      return NextResponse.json(
        { error: "Failed to load audit log" },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      events: page,
      hasMore,
      nextBefore: page.length > 0 ? page[page.length - 1].created_at : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
