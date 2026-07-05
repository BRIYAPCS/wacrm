"use client";

import type { ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import type { FeatureKey } from "@/lib/plans/catalog";
import { UpgradePrompt } from "./upgrade-prompt";

/**
 * Client-side page gate: renders an upsell instead of `children` when the
 * account's plan doesn't include `feature`. Cosmetic — the server still
 * enforces the corresponding API routes; this is the friendly front door.
 *
 * While the profile/plan is still loading we render children (the page's
 * own skeleton) rather than flashing the gate, then swap to the upsell once
 * we're certain the feature is unavailable.
 */
export function FeatureGate({
  feature,
  title,
  description,
  children,
}: {
  feature: FeatureKey;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { hasFeature, profileLoading } = useAuth();
  if (!profileLoading && !hasFeature(feature)) {
    return <UpgradePrompt title={title} description={description} />;
  }
  return <>{children}</>;
}
