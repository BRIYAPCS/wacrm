"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";

/**
 * Import the connected WhatsApp number's existing chats + history into the
 * inbox (admin/owner only). Runs in the background; conversations fill in live
 * via realtime as they're imported.
 */
export function SyncChatsButton() {
  const canManage = useCan("edit-settings");
  const [syncing, setSyncing] = useState(false);

  if (!canManage) return null;

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/waha/sync", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't start the import.");
        return;
      }
      toast.success(
        "Importing your chats — they'll appear here over the next few minutes.",
      );
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={sync}
      disabled={syncing}
      title="Import existing chats from the connected number"
    >
      {syncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      Sync chats
    </Button>
  );
}
