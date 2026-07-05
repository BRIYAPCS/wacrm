import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePlatformAdmin } from "@/lib/auth/platform";
import { SuperadminPanel } from "@/components/superadmin/superadmin-panel";

// Never index the vendor console, and 404 for anyone who isn't a platform
// admin (don't reveal the surface exists).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SuperadminPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }
  return <SuperadminPanel />;
}
