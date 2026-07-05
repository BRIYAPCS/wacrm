// ============================================================
// POST /api/ai/summarize  (agent+)
//
// Body: { conversation_id } or { contact_id }
// Returns: { summary, sentiment, suggested_tags[] }
//
// Read-only: reads the recent conversation, asks the account's BYO
// provider for a compact JSON summary + sentiment + tag suggestions, and
// hands it back. Never sends or stores anything. Works even when the
// auto-reply master switch is off (it's an on-demand agent tool).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, requireFeature, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { loadAiConfig } from "@/lib/ai/config";
import { buildConversationContext } from "@/lib/ai/context";
import { generateRaw } from "@/lib/ai/generate";
import { AiError } from "@/lib/ai/types";

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
type Sentiment = (typeof SENTIMENTS)[number];

const SYSTEM_PROMPT = `You summarize a customer-support WhatsApp conversation for the agent handling it.
Respond with a single compact JSON object and NOTHING else (no code fences, no prose):
{
  "summary": "2-3 sentences: the situation and what the customer needs or is asking for",
  "sentiment": "positive" | "neutral" | "negative",
  "suggested_tags": ["short-lowercase-tag"]
}
Rules:
- "sentiment" reflects the customer's mood/tone.
- "suggested_tags": 0 to 4 short, lowercase, hyphenated topic tags (e.g. "billing", "refund", "urgent", "complaint", "shipping"). Omit if unclear.
- Write the summary in the conversation's language.`;

/** Pull the first {...} block out of the model text and parse it. */
function extractJson(raw: string): Record<string, unknown> | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    requireFeature(ctx, "ai", "The AI assistant");
    const { supabase, accountId, userId } = ctx;

    const userLimit = checkRateLimit(`ai-summary:${userId}`, RATE_LIMITS.aiDraft);
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const acctLimit = checkRateLimit(`ai-summary-acct:${accountId}`, RATE_LIMITS.aiDraftAccount);
    if (!acctLimit.success) return rateLimitResponse(acctLimit);

    const body = (await request.json().catch(() => null)) as
      | { conversation_id?: unknown; contact_id?: unknown }
      | null;

    // Resolve the target conversation (explicit id, or the contact's latest).
    let conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
    if (!conversationId && typeof body?.contact_id === "string" && body.contact_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("account_id", accountId)
        .eq("contact_id", body.contact_id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      conversationId = (conv as { id: string } | null)?.id ?? "";
    }
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id or contact_id is required" }, { status: 400 });
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false });
    if (!config) {
      return NextResponse.json(
        { error: "AI isn't set up yet.", code: "ai_not_configured" },
        { status: 400 },
      );
    }

    const messages = await buildConversationContext(supabase, conversationId);
    if (messages.length === 0) {
      return NextResponse.json({ error: "Not enough conversation to summarize yet." }, { status: 422 });
    }

    let raw: string;
    try {
      raw = await generateRaw({ config, systemPrompt: SYSTEM_PROMPT, messages });
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      throw err;
    }

    const parsed = extractJson(raw);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) {
      return NextResponse.json({ error: "The assistant didn't return a summary." }, { status: 502 });
    }
    const sentiment: Sentiment = SENTIMENTS.includes(parsed?.sentiment as Sentiment)
      ? (parsed!.sentiment as Sentiment)
      : "neutral";
    const suggested_tags = Array.isArray(parsed?.suggested_tags)
      ? (parsed!.suggested_tags as unknown[])
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim().toLowerCase().slice(0, 40))
          .slice(0, 4)
      : [];

    return NextResponse.json({ summary, sentiment, suggested_tags });
  } catch (err) {
    return toErrorResponse(err);
  }
}
