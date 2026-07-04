// ============================================================
// /api/account/auto-assign — round-robin auto-assignment config.
//   GET   — enabled flag + the agent-eligible roster with each
//           member's `assignable` flag.
//   PATCH — toggle enabled and/or set members' `assignable` flags.
//
// Admin+ only. Uses the service-role client for the roster read and
// per-member writes (the `profiles_update` RLS is own-profile-only, so
// an admin can't flip a teammate's flag through their own client). Every
// query is scoped to the caller's own account_id, so tenancy holds.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const ROTATION_ROLES = ["owner", "admin", "agent"];

async function loadState(accountId: string) {
  const admin = supabaseAdmin();
  const [{ data: acct }, { data: members }] = await Promise.all([
    admin.from("accounts").select("auto_assign_enabled").eq("id", accountId).maybeSingle(),
    admin
      .from("profiles")
      .select("user_id, full_name, account_role, assignable")
      .eq("account_id", accountId)
      .in("account_role", ROTATION_ROLES)
      .order("full_name", { ascending: true }),
  ]);
  return {
    enabled: acct?.auto_assign_enabled ?? false,
    members: members ?? [],
  };
}

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    return NextResponse.json(await loadState(ctx.accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`autoAssign:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { enabled?: unknown; assignable?: unknown }
      | null;

    const admin = supabaseAdmin();

    if (typeof body?.enabled === "boolean") {
      const { error } = await admin
        .from("accounts")
        .update({ auto_assign_enabled: body.enabled })
        .eq("id", ctx.accountId);
      if (error) {
        console.error("[PATCH auto-assign] enabled:", error);
        return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
      }
    }

    // `assignable` is a map of user_id → boolean. Each write is scoped to
    // this account so an admin can only ever flip their own members.
    if (body?.assignable && typeof body.assignable === "object") {
      for (const [userId, value] of Object.entries(
        body.assignable as Record<string, unknown>,
      )) {
        if (typeof value !== "boolean") continue;
        const { error } = await admin
          .from("profiles")
          .update({ assignable: value })
          .eq("user_id", userId)
          .eq("account_id", ctx.accountId);
        if (error) {
          console.error("[PATCH auto-assign] member flag:", error);
          return NextResponse.json({ error: "Failed to update a member" }, { status: 500 });
        }
      }
    }

    return NextResponse.json(await loadState(ctx.accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}
