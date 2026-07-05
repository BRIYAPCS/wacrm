// ============================================================
// PATCH /api/superadmin/accounts/[id]/plan  (platform admin only)
//
// Set (or clear) an account's subscription tier. Writing here marks the
// plan as manually-managed (plan_source='manual'), so a later Stripe
// webhook won't silently overwrite a comp/manual plan.
//
// Body: { plan: 'basic' | 'pro' | 'advanced' | null }  (null = defer to
// the instance default)
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";
import { isPlanTier } from "@/lib/plans/catalog";
import { recordAudit } from "@/lib/audit/record";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, userId } = await requirePlatformAdmin();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as { plan?: unknown } | null;
    const plan = body?.plan;
    if (plan !== null && !isPlanTier(plan)) {
      return NextResponse.json(
        { error: "'plan' must be 'basic', 'pro', 'advanced', or null" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("accounts")
      .update({ plan, plan_source: "manual" })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[superadmin plan PATCH] error:", error);
      return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    recordAudit({
      accountId: id,
      actorUserId: userId,
      action: "platform.plan_changed",
      entityType: "account",
      entityId: id,
      metadata: { plan },
    });

    return NextResponse.json({ success: true, plan });
  } catch (err) {
    if (err instanceof NotPlatformAdminError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[superadmin plan PATCH] uncaught:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
