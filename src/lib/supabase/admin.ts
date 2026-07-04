import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Service-role Supabase client. Bypasses RLS — SERVER ONLY.
// Never import this into a client component or expose the key.
//
// Use it for privileged operations that have no user session or
// must reach across RLS: the WhatsApp webhook, the automation /
// flow engines, the public-API key lookup, and account teardown
// (deleting auth.users, which the SSR client cannot do).
//
// Lazily instantiated and memoised so we reuse one client per
// server process rather than building one per request.
// ============================================================
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _adminClient;
}
