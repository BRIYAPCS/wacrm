// ============================================================
// Platform-admin (vendor / "superadmin") authentication.
//
// This is a DIFFERENT axis from account roles: an account `owner` runs a
// tenant; a platform admin is YOU, the vendor, who can see across every
// account and set their subscription tier. Never conflate the two.
//
// Identity is proven two ways (table takes precedence over env):
//   1. a row in `platform_admins` (migration 050) — durable, seeded via
//      SQL / service role; the table is RLS-locked (no client policies).
//   2. env `PLATFORM_ADMIN_EMAILS` (comma-separated) — a bootstrap so a
//      fresh deploy can get its first superadmin without SQL. Mirrors the
//      existing ALLOWED_INVITE_HOSTS env-list convention.
//
// On success we return a SERVICE-ROLE client — cross-account reads/writes
// must bypass RLS (which isolates tenants). Identity is proven BEFORE any
// service-role call is made.
//
// Failures throw NotPlatformAdminError → a 404 (not 403): we don't reveal
// that the superadmin surface exists to non-admins.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class NotPlatformAdminError extends Error {
  readonly status = 404 as const;
  constructor() {
    super("Not found");
    this.name = "NotPlatformAdminError";
  }
}

export interface PlatformAdminContext {
  /** Service-role client — RLS-bypassing, for cross-account work. */
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
}

function envAllowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve the caller and require them to be a platform admin. Throws
 * NotPlatformAdminError otherwise. Use in `/superadmin` server components
 * (call `notFound()` on throw) and every `/api/superadmin/*` route.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const ssr = await createClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) throw new NotPlatformAdminError();

  const admin = supabaseAdmin();

  // 1. platform_admins table (service-role read; the table is RLS-locked).
  const { data: row } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let ok = !!row;

  // 2. env allowlist bootstrap. Only honor a CONFIRMED email — otherwise, on a
  // deploy with email confirmation disabled (or an OAuth provider returning an
  // unverified address), someone could register a listed admin email and
  // self-escalate to the service-role client.
  if (!ok) {
    const email = user.email?.toLowerCase();
    ok = !!email && !!user.email_confirmed_at && envAllowlist().includes(email);
  }

  if (!ok) throw new NotPlatformAdminError();

  return { supabase: admin, userId: user.id, email: user.email ?? null };
}
