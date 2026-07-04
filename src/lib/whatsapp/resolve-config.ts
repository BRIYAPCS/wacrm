// ============================================================
// Resolve which WhatsApp number (whatsapp_config row) to use for an
// account. Before multi-number, every caller did
// `.eq('account_id', x).single()` — which throws the moment an account
// has more than one number. This helper centralises the choice so all
// call sites agree and none of them break.
//
// Resolution order:
//   1. `preferId` — the specific number a conversation is on (from
//      conversations.whatsapp_config_id). The reply/outbound goes from
//      the same number the customer is talking to.
//   2. the account DEFAULT (`is_default = true`) — used when there is no
//      conversation context (public-API sends, broadcasts, template/
//      media/react operations).
//   3. any connected number, else any number at all — last-resort
//      fallback so a misconfigured default never fully blocks sending.
//
// Returns null when the account has no WhatsApp config at all.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WhatsAppConfigRow = Record<string, any>;

export interface ResolveConfigOptions {
  /** The conversation's whatsapp_config_id, if known. Tried first. */
  preferId?: string | null;
  /** Columns to select. Defaults to '*'. */
  columns?: string;
}

export async function resolveAccountConfig(
  db: SupabaseClient,
  accountId: string,
  opts: ResolveConfigOptions = {},
): Promise<WhatsAppConfigRow | null> {
  const columns = opts.columns ?? '*';

  // 1) The conversation's own number, if it still exists in this account.
  if (opts.preferId) {
    const { data } = await db
      .from('whatsapp_config')
      .select(columns)
      .eq('account_id', accountId)
      .eq('id', opts.preferId)
      .maybeSingle();
    if (data) return data as WhatsAppConfigRow;
  }

  // 2) The account default.
  const { data: def } = await db
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
    .eq('is_default', true)
    .maybeSingle();
  if (def) return def as WhatsAppConfigRow;

  // 3) Last-resort: prefer a connected number, else the oldest row.
  // Ordering by status DESC puts 'disconnected' before 'connected'
  // alphabetically, so order by connected_at instead (non-null first).
  const { data: any } = await db
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
    .order('connected_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (any as WhatsAppConfigRow) ?? null;
}

/**
 * Resolve the config for a specific conversation — the number the thread
 * is currently on (falling back to the account default). Convenience for
 * outbound paths (flows / automations) that have a conversationId but
 * haven't loaded its `whatsapp_config_id`.
 */
export async function resolveConfigForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  columns = '*',
): Promise<WhatsAppConfigRow | null> {
  const { data: conv } = await db
    .from('conversations')
    .select('whatsapp_config_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  return resolveAccountConfig(db, accountId, {
    preferId: conv?.whatsapp_config_id ?? null,
    columns,
  });
}
