// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import {
  effectiveTier,
  parseOverrides,
  resolveEntitlements,
  checkLimit,
  type Entitlements,
} from "@/lib/plans/entitlements";
import type { FeatureKey, LimitKey } from "@/lib/plans/catalog";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Thrown when a route is gated behind a feature/limit the account's plan
 * doesn't include. 403 (not 402) so proxies/clients treat it normally; the
 * body carries a machine code so the client can show an upsell instead of a
 * generic error.
 */
export class PlanUpgradeRequiredError extends Error {
  readonly status = 403 as const;
  constructor(
    message: string,
    readonly feature?: FeatureKey,
    readonly limit?: LimitKey,
  ) {
    super(message);
    this.name = "PlanUpgradeRequiredError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof PlanUpgradeRequiredError) {
    return NextResponse.json(
      {
        error: err.message,
        code: "plan_upgrade_required",
        feature: err.feature,
        limit: err.limit,
      },
      { status: err.status },
    );
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
  /**
   * Resolved plan entitlements for this account (features + numeric
   * limits). Loaded in the same round trip as the account. Use
   * `requireFeature` / `requireWithinLimit` to gate routes.
   */
  entitlements: Entitlements;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    // plan + plan_overrides added in migration 050; folded into the same
    // point lookup so entitlement resolution costs zero extra round trips.
    .select("id, name, plan, plan_overrides")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  // Resolve entitlements: account tier (or the instance default from env
  // DEFAULT_PLAN for isolated single-client deploys, else 'advanced') with
  // per-account overrides merged on top.
  // NEXT_PUBLIC_DEFAULT_PLAN is the per-instance default (one knob honored
  // by both this server resolver and the client in use-auth). Only used
  // when accounts.plan is NULL — i.e. isolated single-client deploys.
  const entitlements = resolveEntitlements(
    effectiveTier(
      (account as { plan?: string | null }).plan ?? null,
      process.env.NEXT_PUBLIC_DEFAULT_PLAN ?? null,
    ),
    parseOverrides((account as { plan_overrides?: unknown }).plan_overrides),
  );

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: { id: account.id, name: account.name },
    entitlements,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}

// ------------------------------------------------------------
// Plan gates — the tier analogue of requireRole. Call inside a route's
// try/catch; the thrown PlanUpgradeRequiredError maps to a 403 with an
// upsell code via toErrorResponse().
// ------------------------------------------------------------

/** Require the account's plan to include a feature module. */
export function requireFeature(
  ctx: Pick<AccountContext, "entitlements">,
  feature: FeatureKey,
  label?: string,
): void {
  if (!ctx.entitlements.features.has(feature)) {
    throw new PlanUpgradeRequiredError(
      `${label ?? "This feature"} isn't included in your plan.`,
      feature,
    );
  }
}

/**
 * Require adding one more of `key` to be within the plan's limit, given the
 * CURRENT count. Enforce on create/add only — never retroactively (a
 * downgraded account keeps existing rows but can't add past the cap).
 */
export function requireWithinLimit(
  ctx: Pick<AccountContext, "entitlements">,
  key: LimitKey,
  currentCount: number,
  label?: string,
): void {
  const check = checkLimit(ctx.entitlements, key, currentCount);
  if (!check.allowed) {
    throw new PlanUpgradeRequiredError(
      `You've reached your plan's limit of ${check.limit} ${label ?? key}.`,
      undefined,
      key,
    );
  }
}
