"use client";

import { useState } from "react";
import { Check, Loader2, Minus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  PLANS,
  PLAN_LABELS,
  PLAN_TIERS,
  type FeatureKey,
  type PlanTier,
} from "@/lib/plans/catalog";
import { SettingsPanelHead } from "./settings-panel-head";
import { cn } from "@/lib/utils";

const FEATURE_ROWS: { key: FeatureKey; label: string }[] = [
  { key: "ai", label: "AI assistant + knowledge base" },
  { key: "automations", label: "Automations" },
  { key: "flows", label: "Flows (visual builder)" },
  { key: "broadcasts", label: "Broadcasts" },
  { key: "multi_number", label: "Multiple WhatsApp numbers" },
  { key: "public_api", label: "Public REST API" },
  { key: "audit_log", label: "Audit log" },
  { key: "reports", label: "Reports" },
];

// NEXT_PUBLIC so the client knows whether to show self-serve upgrade
// buttons (Stripe) or a "contact us" note (per-instance / manual).
const STRIPE_ENABLED = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

export function BillingPanel() {
  const { entitlements, isOwner } = useAuth();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const current = entitlements.tier;

  const startCheckout = async (tier: PlanTier) => {
    setBusyTier(tier);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (data?.url) window.location.assign(data.url);
      else setBusyTier(null);
    } catch {
      setBusyTier(null);
    }
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Plan & billing"
        description="Your current subscription tier and what it includes."
      />

      <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Current plan
          </div>
          <div className="text-lg font-semibold text-foreground">
            {PLAN_LABELS[current]}
          </div>
        </div>
      </div>

      {/* Tier comparison */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Feature</th>
              {PLAN_TIERS.map((t) => (
                <th
                  key={t}
                  className={cn(
                    "px-4 py-3 text-center",
                    t === current && "text-primary",
                  )}
                >
                  {PLAN_LABELS[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {FEATURE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-2.5 text-foreground">{row.label}</td>
                {PLAN_TIERS.map((t) => (
                  <td key={t} className="px-4 py-2.5 text-center">
                    {PLANS[t].features[row.key] ? (
                      <Check className="mx-auto h-4 w-4 text-primary" />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-muted/20">
              <td className="px-4 py-2.5 font-medium text-foreground">Team seats</td>
              {PLAN_TIERS.map((t) => (
                <td key={t} className="px-4 py-2.5 text-center text-muted-foreground">
                  {PLANS[t].limits.seats === -1 ? "Unlimited" : PLANS[t].limits.seats}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Upgrade CTAs */}
      <div className="mt-6">
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the account owner can change the plan.
          </p>
        ) : STRIPE_ENABLED ? (
          <div className="flex flex-wrap gap-2">
            {PLAN_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={t === current || busyTier !== null}
                onClick={() => startCheckout(t)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  t === current
                    ? "cursor-default border-border text-muted-foreground"
                    : "border-primary/50 text-primary hover:bg-primary/10",
                )}
              >
                {busyTier === t && <Loader2 className="h-4 w-4 animate-spin" />}
                {t === current ? "Current plan" : `Switch to ${PLAN_LABELS[t]}`}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            To change your plan, contact your provider.
          </p>
        )}
      </div>
    </section>
  );
}
