"use client";

import type { ReactNode } from "react";
import { FeatureGate } from "@/components/plans/feature-gate";

// Gates the entire /automations subtree behind the `automations` plan
// feature. Server routes under /api/automations enforce the same.
export default function AutomationsLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate
      feature="automations"
      title="Automations"
      description="Automations aren't included in your current plan. Upgrade to trigger actions on inbound messages, keywords, and schedules."
    >
      {children}
    </FeatureGate>
  );
}
