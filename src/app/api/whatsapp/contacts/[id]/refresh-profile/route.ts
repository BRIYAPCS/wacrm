// ============================================================
// POST /api/whatsapp/contacts/[id]/refresh-profile  (agent+)
//
// Re-pull a contact's WhatsApp profile (photo + about). Only works when the
// contact's conversation is on a wsapi.chat number — Meta/Twilio can't
// supply a photo. Returns the refreshed avatar_url + about.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/whatsapp/encryption";
import { enrichContactFromWsapi } from "@/lib/wsapi/profile";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    // Contact (account-scoped).
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id, phone")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    // The number this contact's thread is on.
    const { data: conv } = await ctx.supabase
      .from("conversations")
      .select("whatsapp_config_id")
      .eq("account_id", ctx.accountId)
      .eq("contact_id", id)
      .maybeSingle();
    const configId = conv?.whatsapp_config_id;
    if (!configId) {
      return NextResponse.json(
        { error: "No WhatsApp number is linked to this conversation yet." },
        { status: 400 },
      );
    }

    const { data: cfg } = await ctx.supabase
      .from("whatsapp_config")
      .select("provider, wsapi_instance_id, access_token")
      .eq("id", configId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!cfg || cfg.provider !== "wsapi") {
      return NextResponse.json(
        { error: "Profile photos are only available on wsapi.chat numbers." },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();
    await enrichContactFromWsapi(
      admin,
      { instanceId: cfg.wsapi_instance_id as string, apiKey: decrypt(cfg.access_token) },
      id,
      contact.phone,
      { force: true },
    );

    const { data: updated } = await admin
      .from("contacts")
      .select("avatar_url, about")
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      avatar_url: updated?.avatar_url ?? null,
      about: updated?.about ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
