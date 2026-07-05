// ============================================================
// GET /api/superadmin/accounts  (platform admin only)
//
// Lists every account with its tier + member count for the vendor's
// superadmin panel. Uses the service-role client (cross-account read),
// gated by requirePlatformAdmin — 404 for everyone else.
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";

export async function GET() {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { data, error } = await supabase
      .from("accounts")
      .select(
        "id, name, plan, plan_overrides, plan_source, stripe_subscription_id, created_at, profiles(count)",
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[superadmin/accounts] error:", error);
      return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
    }

    const accounts = (data ?? []).map((a) => {
      const profiles = a.profiles as unknown as { count: number }[] | null;
      return {
        id: a.id,
        name: a.name,
        plan: a.plan as string | null,
        plan_overrides: a.plan_overrides,
        plan_source: a.plan_source as string,
        stripe_subscription_id: a.stripe_subscription_id as string | null,
        member_count: profiles?.[0]?.count ?? 0,
        created_at: a.created_at,
      };
    });

    return NextResponse.json({ accounts });
  } catch (err) {
    if (err instanceof NotPlatformAdminError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[superadmin/accounts] uncaught:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
