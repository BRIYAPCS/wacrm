"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { PLAN_TIERS, PLAN_LABELS, type FeatureKey } from "@/lib/plans/catalog";

// Features an admin can force-ON as a per-account add-on (over the base
// tier). Checking a box sets plan_overrides.features[key]=true; unchecking
// removes it (revert to the tier's default).
const OVERRIDABLE: { key: FeatureKey; label: string }[] = [
  { key: "ai", label: "AI" },
  { key: "flows", label: "Flows" },
  { key: "automations", label: "Automations" },
  { key: "public_api", label: "API" },
  { key: "multi_number", label: "Multi-number" },
  { key: "audit_log", label: "Audit log" },
];

interface AccountRow {
  id: string;
  name: string;
  plan: string | null;
  plan_overrides: unknown;
  plan_source: string;
  stripe_subscription_id: string | null;
  member_count: number;
}

function featureOverrides(raw: unknown): Partial<Record<FeatureKey, boolean>> {
  if (raw && typeof raw === "object" && "features" in raw) {
    const f = (raw as { features?: unknown }).features;
    if (f && typeof f === "object") return f as Partial<Record<FeatureKey, boolean>>;
  }
  return {};
}

export function SuperadminPanel() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/superadmin/accounts");
    if (!res.ok) {
      setError("Failed to load accounts.");
      return;
    }
    const data = (await res.json()) as { accounts: AccountRow[] };
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (id: string, path: string, body: unknown) => {
      setSavingId(id);
      try {
        const res = await fetch(`/api/superadmin/accounts/${id}/${path}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        setError("Save failed — try again.");
      } finally {
        setSavingId(null);
      }
    },
    [load],
  );

  const setPlan = (id: string, value: string) =>
    patch(id, "plan", { plan: value === "default" ? null : value });

  const toggleFeature = (row: AccountRow, key: FeatureKey, on: boolean) => {
    const features = { ...featureOverrides(row.plan_overrides) };
    if (on) features[key] = true;
    else delete features[key];
    patch(row.id, "overrides", { overrides: { features } });
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Platform admin
          </h1>
          <p className="text-sm text-muted-foreground">
            Set each account&apos;s subscription tier and per-account add-ons.
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {accounts === null ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Add-ons (force on)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => {
                const ovr = featureOverrides(a.plan_overrides);
                return (
                  <tr key={a.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{a.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {a.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.member_count}</td>
                    <td className="px-4 py-3">
                      <select
                        value={a.plan ?? "default"}
                        disabled={savingId === a.id}
                        onChange={(e) => setPlan(a.id, e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      >
                        <option value="default">Default (instance)</option>
                        {PLAN_TIERS.map((t) => (
                          <option key={t} value={t}>
                            {PLAN_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{a.plan_source}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {OVERRIDABLE.map(({ key, label }) => (
                          <label
                            key={key}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={ovr[key] === true}
                              disabled={savingId === a.id}
                              onChange={(e) => toggleFeature(a, key, e.target.checked)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
