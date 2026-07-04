// ============================================================
// GET /api/reports?days=7|30|90 — account analytics over a range.
// Any member. Delegates to the `account_report` RPC (server-side
// aggregation; the RPC re-checks membership).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

const ALLOWED_DAYS = new Set([7, 30, 90]);

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const daysParam = Number(new URL(request.url).searchParams.get("days"));
    const days = ALLOWED_DAYS.has(daysParam) ? daysParam : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { data, error } = await ctx.supabase.rpc("account_report", {
      p_account_id: ctx.accountId,
      p_since: since.toISOString(),
    });
    if (error) {
      console.error("[GET /api/reports]", error);
      return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
    }
    return NextResponse.json({ days, ...(data as object) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
