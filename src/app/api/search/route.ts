// ============================================================
// GET /api/search?q=… — search the account's conversations by
// message content (full-text) and by contact (name / phone / company
// / email). Any member.
//
// Returns drop-in `Conversation` objects (same shape as the inbox
// list) plus an optional `snippet` of the matching message, so the
// conversation list can render + select results with no special
// casing. Runs under the caller's RLS client, so tenancy is enforced
// by the messages / conversations / contacts policies.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation } from "@/types";

const MAX_RESULTS = 30;

/** A short excerpt of `text` centered on the query match (falls back to
 *  the head when the match isn't a literal substring, e.g. after
 *  stemming). */
function makeSnippet(text: string | null, q: string): string | null {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const raw = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (raw.length < 2) return NextResponse.json({ results: [] });

    // For ILIKE we need a literal pattern — strip the wildcards/operators
    // that would otherwise change the match or break PostgREST's `.or`
    // filter grammar. FTS (websearch) sanitizes its own input, so `raw`
    // is safe there.
    const ilike = raw.replace(/[%,()*\\]/g, " ").trim();

    // 1. Message full-text matches → conversation_id + snippet source.
    const { data: msgRows } = await ctx.supabase
      .from("messages")
      .select("conversation_id, content_text, created_at")
      .textSearch("fts", raw, { type: "websearch", config: "simple" })
      .order("created_at", { ascending: false })
      .limit(50);

    const snippetByConv = new Map<string, string | null>();
    const orderAt = new Map<string, string>();
    for (const m of (msgRows ?? []) as {
      conversation_id: string;
      content_text: string | null;
      created_at: string;
    }[]) {
      if (!snippetByConv.has(m.conversation_id)) {
        snippetByConv.set(m.conversation_id, makeSnippet(m.content_text, raw));
        orderAt.set(m.conversation_id, m.created_at);
      }
    }

    // 2. Contact matches → their conversation ids.
    const convIds = new Set<string>(snippetByConv.keys());
    if (ilike) {
      const orFilter = ["name", "phone", "company", "email"]
        .map((c) => `${c}.ilike.%${ilike}%`)
        .join(",");
      const { data: contactRows } = await ctx.supabase
        .from("contacts")
        .select("id")
        .or(orFilter)
        .limit(20);
      const contactIds = (contactRows ?? []).map((c) => (c as { id: string }).id);
      if (contactIds.length > 0) {
        const { data: convRows } = await ctx.supabase
          .from("conversations")
          .select("id")
          .in("contact_id", contactIds)
          .limit(30);
        for (const c of convRows ?? []) convIds.add((c as { id: string }).id);
      }
    }

    if (convIds.size === 0) return NextResponse.json({ results: [] });

    // 3. Load the matched conversations in the inbox's own shape.
    const { data: conversations, error } = await ctx.supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .in("id", Array.from(convIds).slice(0, MAX_RESULTS));
    if (error) {
      console.error("[GET /api/search] load error:", error);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    const results = (conversations ?? [])
      .map((raw) => {
        const conversation = normalizeConversation(
          raw as Parameters<typeof normalizeConversation>[0],
        );
        return {
          conversation,
          snippet: snippetByConv.get(conversation.id) ?? null,
        };
      })
      // Recency: prefer the matching message time, else last activity.
      .sort((a, b) => {
        const at =
          orderAt.get(a.conversation.id) ??
          a.conversation.last_message_at ??
          "";
        const bt =
          orderAt.get(b.conversation.id) ??
          b.conversation.last_message_at ??
          "";
        return bt.localeCompare(at);
      });

    return NextResponse.json({ results } satisfies {
      results: { conversation: Conversation; snippet: string | null }[];
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
