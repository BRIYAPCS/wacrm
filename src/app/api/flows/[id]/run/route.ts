// ============================================================
// POST /api/flows/[id]/run — manually start a flow for a contact.
//
// Agent+ only (viewers can't message customers). Body: { contactId }.
// The engine resolves the contact's conversation, guards the
// one-active-run-per-contact rule, and walks the flow from its entry
// node — sending the first prompt(s) right away.
//
// This is what makes `manual`-trigger flows usable (they never
// auto-start from inbound), and it also lets an agent re-run any
// active flow on demand.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, requireFeature, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { startFlowManually } from "@/lib/flows/engine";

// Reason → (HTTP status, human message). Kept exhaustive so a new
// engine reason can't silently fall through to a 200.
const REASON_MAP: Record<
  Exclude<Awaited<ReturnType<typeof startFlowManually>>, { ok: true }>["reason"],
  [number, string]
> = {
  flow_not_found: [404, "Flow not found."],
  flow_not_active: [409, "This flow isn't active — activate it before running it."],
  no_entry_node: [409, "This flow has no entry node to start from."],
  no_conversation: [400, "This contact has no conversation to run the flow in."],
  already_in_flow: [409, "This contact is already in an active flow."],
  insert_failed: [500, "Couldn't start the flow. Please try again."],
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    requireFeature(ctx, "flows", "Flows");

    // Starting a flow fires outbound WhatsApp messages, so meter it
    // like an individual send (60/min per agent).
    const limit = checkRateLimit(`flowRun:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const { id: flowId } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { contactId?: unknown }
      | null;
    const contactId = body?.contactId;
    if (typeof contactId !== "string" || !contactId) {
      return NextResponse.json(
        { error: "'contactId' is required" },
        { status: 400 },
      );
    }

    const result = await startFlowManually({
      accountId: ctx.accountId,
      flowId,
      contactId,
      startedByUserId: ctx.userId,
    });

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        flow_run_id: result.flow_run_id,
        outcome: result.outcome,
      });
    }

    const [status, message] = REASON_MAP[result.reason];
    return NextResponse.json(
      { error: message, reason: result.reason },
      { status },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
