// ============================================================
// Resolve an account's plan entitlements from any Supabase client (typically
// the service-role client), for RUNTIME gating in fire-and-forget engines
// (flow runner, automations, AI auto-reply) that have no user session and so
// can't use `getCurrentAccount()`.
//
// Same precedence as the request-scoped resolver in src/lib/auth/account.ts:
//   accounts.plan_overrides → accounts.plan → env NEXT_PUBLIC_DEFAULT_PLAN →
//   DEFAULT_TIER.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  effectiveTier,
  parseOverrides,
  resolveEntitlements,
  type Entitlements,
} from "./entitlements";

export async function resolveAccountEntitlements(
  db: SupabaseClient,
  accountId: string,
): Promise<Entitlements> {
  const { data } = await db
    .from("accounts")
    .select("plan, plan_overrides")
    .eq("id", accountId)
    .maybeSingle();
  return resolveEntitlements(
    effectiveTier(
      (data as { plan?: string | null } | null)?.plan ?? null,
      process.env.NEXT_PUBLIC_DEFAULT_PLAN ?? null,
    ),
    parseOverrides((data as { plan_overrides?: unknown } | null)?.plan_overrides),
  );
}
