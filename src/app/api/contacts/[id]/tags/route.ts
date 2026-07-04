// ============================================================
// POST /api/contacts/[id]/tags  (agent+)
//
// Body: { name } — attach a tag by name to the contact, creating the
// tag in the account if it doesn't exist yet. Powers "apply this
// AI-suggested tag" in one click. Idempotent (unique contact_id+tag_id).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const NAME_MAX = 40;
const DEFAULT_TAG_COLOR = "#3b82f6";

// Escape LIKE/ILIKE metacharacters so a tag name containing `%` or `_`
// (e.g. "50%", "a_b") is matched literally rather than as a wildcard —
// otherwise the dedupe lookup could match the wrong existing tag or miss
// the real duplicate. Backslash first so we don't double-escape.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`tagApply:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id: contactId } = await context.params;
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Tag name is required" }, { status: 400 });
    if (name.length > NAME_MAX)
      return NextResponse.json({ error: `Tag name must be ${NAME_MAX} characters or fewer` }, { status: 400 });

    // Verify the contact is in the caller's account (RLS also enforces this).
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    // Find an existing tag by (case-insensitive) name, else create it.
    const { data: existing } = await ctx.supabase
      .from("tags")
      .select("id, name, color")
      .eq("account_id", ctx.accountId)
      .ilike("name", escapeLike(name))
      .maybeSingle();

    let tag = existing as { id: string; name: string; color: string } | null;
    if (!tag) {
      const { data: created, error: createErr } = await ctx.supabase
        .from("tags")
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          name,
          color: DEFAULT_TAG_COLOR,
        })
        .select("id, name, color")
        .single();
      if (createErr || !created) {
        console.error("[POST contact tags] create:", createErr);
        return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
      }
      tag = created as { id: string; name: string; color: string };
    }

    // Attach — idempotent via the (contact_id, tag_id) unique constraint.
    const { error: attachErr } = await ctx.supabase
      .from("contact_tags")
      .upsert(
        { contact_id: contactId, tag_id: tag.id },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
      );
    if (attachErr) {
      console.error("[POST contact tags] attach:", attachErr);
      return NextResponse.json({ error: "Failed to apply tag" }, { status: 500 });
    }

    return NextResponse.json({ tag });
  } catch (err) {
    return toErrorResponse(err);
  }
}
