"use client";

// Error boundary for the dashboard route group. Renders inside the
// dashboard shell (sidebar/header stay put), so a crash in one page
// doesn't take down navigation. `reset()` re-renders the segment; the
// link is an escape hatch to a known-good route.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for logs/observability; the UI stays friendly.
    console.error("[dashboard] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong on this page
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          An unexpected error interrupted this view. You can retry, or head back
          to the dashboard — your data is safe.
        </p>
        {error?.digest && (
          <p className="pt-1 text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
