"use client";

import type { ReactNode } from "react";
import { FeatureGate } from "@/components/plans/feature-gate";

// Gates the entire /flows subtree (list + builder + runs) behind the
// `flows` plan feature. Server routes under /api/flows enforce the same.
export default function FlowsLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate
      feature="flows"
      title="Flows"
      description="The visual Flow builder isn't included in your current plan. Upgrade to design multi-step conversation flows."
    >
      {children}
    </FeatureGate>
  );
}
