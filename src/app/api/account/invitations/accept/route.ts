// ============================================================
// POST /api/account/invitations/accept
//
// Called by /accept-invite AFTER an invited user sets their password.
// The invited user is already a member (handle_new_user attached them at
// invite time), so this just: (1) sets their display name, and (2) marks
// their pending invitation accepted so it drops off the admin's "pending"
// list. The invitation update uses the service role — the invitee isn't an
// admin, so RLS would otherwise block it — keyed strictly on THEIR own
// auth user id.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";

const NAME_MAX = 80;

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as
      | { fullName?: unknown }
      | null;
    const fullName =
      typeof body?.fullName === "string"
        ? body.fullName.trim().slice(0, NAME_MAX)
        : "";

    // Set the display name on the invitee's own profile (RLS: own profile).
    if (fullName) {
      await ctx.supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("user_id", ctx.userId);
    }

    // Mark any pending invitation for this exact user accepted. Service
    // role (invitee can't write account_invitations under RLS), scoped to
    // their own invited_user_id so it can only ever touch their own row.
    await supabaseAdmin()
      .from("account_invitations")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: ctx.userId,
      })
      .eq("invited_user_id", ctx.userId)
      .is("accepted_at", null);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
