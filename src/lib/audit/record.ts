// ============================================================
// Audit trail writer.
//
// `recordAudit(...)` inserts one row into `audit_logs` using the
// service-role client (audit_logs has no INSERT policy — history can
// only be written server-side, never forged from a browser session).
//
// Fire-and-forget by design: auditing must never block or fail the
// action being audited. Every error is swallowed with a warning. Call
// it right AFTER the mutation succeeds:
//
//   await doTheThing()
//   recordAudit({ accountId, actorUserId, action: 'member.removed', ... })
//
// When `actorLabel` isn't supplied, we snapshot the actor's name/email
// from their profile so the trail stays readable after they leave.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy service-role client (same pattern as the webhook). Avoids a
// build-time crash when env vars are absent.
let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

export interface AuditEvent {
  accountId: string;
  /** The member who performed it; null/undefined for system events. */
  actorUserId?: string | null;
  /** Dotted action key, e.g. 'member.role_changed'. */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Pre-resolved actor display name; looked up if omitted. */
  actorLabel?: string | null;
}

/**
 * Write an audit entry. Never throws — resolves to void. Not awaited by
 * callers in practice, but returns the promise so tests can await it.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    let actorLabel = event.actorLabel ?? null;
    if (!actorLabel && event.actorUserId) {
      const { data } = await admin()
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', event.actorUserId)
        .maybeSingle();
      actorLabel =
        (data?.full_name as string | undefined) ||
        (data?.email as string | undefined) ||
        null;
    }

    const { error } = await admin().from('audit_logs').insert({
      account_id: event.accountId,
      actor_user_id: event.actorUserId ?? null,
      actor_label: actorLabel,
      action: event.action,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      metadata: event.metadata ?? {},
    });
    if (error) {
      console.warn('[audit] failed to record event:', event.action, error.message);
    }
  } catch (err) {
    console.warn(
      '[audit] recordAudit threw:',
      err instanceof Error ? err.message : err,
    );
  }
}
