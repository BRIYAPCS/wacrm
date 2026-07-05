"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";

/**
 * Shown in place of a plan-gated module (or as an empty-state) when the
 * account's tier doesn't include a feature. Cosmetic — the server still
 * enforces the gate; this just turns a would-be 403 into an upsell.
 */
export function UpgradePrompt({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {description ??
            "This feature isn't included in your current plan. Upgrade to unlock it."}
        </p>
        <Link
          href="/settings?tab=billing"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" />
          View plans &amp; upgrade
        </Link>
      </div>
    </div>
  );
}
