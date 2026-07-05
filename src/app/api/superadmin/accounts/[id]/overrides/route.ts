// ============================================================
// PATCH /api/superadmin/accounts/[id]/overrides  (platform admin only)
//
// Set an account's per-account entitlement overrides (add-ons) — the
// "turn on one extra feature for this client" lever. Merged over the base
// tier by resolveEntitlements. Absolute values, not deltas.
//
// Body: { overrides: { features?: {<key>:bool}, limits?: {<key>:number} } }
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";
import { parseOverrides } from "@/lib/plans/entitlements";
import { recordAudit } from "@/lib/audit/record";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, userId } = await requirePlatformAdmin();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { overrides?: unknown }
      | null;
    // Normalise to a safe shape (drops unknown keys / malformed values).
    const overrides = parseOverrides(body?.overrides);

    const { data, error } = await supabase
      .from("accounts")
      .update({ plan_overrides: overrides })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[superadmin overrides PATCH] error:", error);
      return NextResponse.json({ error: "Failed to update overrides" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    recordAudit({
      accountId: id,
      actorUserId: userId,
      action: "platform.overrides_changed",
      entityType: "account",
      entityId: id,
      metadata: { overrides },
    });

    return NextResponse.json({ success: true, overrides });
  } catch (err) {
    if (err instanceof NotPlatformAdminError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[superadmin overrides PATCH] uncaught:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
