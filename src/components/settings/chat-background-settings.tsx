"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ChatBackgroundPicker } from "@/components/inbox/chat-background-picker";
import {
  backgroundStyle,
  isValidBackground,
  resolveBackgroundToken,
} from "@/lib/inbox/backgrounds";

/**
 * Account-wide chat-background default (owner/admin only). Unlike the rest
 * of the Appearance panel — which is device-scoped, localStorage-backed —
 * this writes to `accounts.inbox_background`, so it's shared across the
 * whole team. The `accounts` UPDATE RLS is already admin+, so the write
 * goes straight from the client, mirroring the currency picker.
 *
 * Hidden entirely for non-admins (they can't change it, and it's a team
 * setting rather than a personal one).
 */
export function ChatBackgroundSettings() {
  const { account, canEditSettings, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!canEditSettings) return null;

  const current = account?.inbox_background ?? null;
  // Account scope has no "inherit" — clearing means the built-in doodle.
  const previewToken = resolveBackgroundToken(null, current);
  const preview = backgroundStyle(previewToken);

  const handleSelect = async (token: string | null) => {
    if (!account?.id) return;
    if (!isValidBackground(token)) {
      toast.error("That background can't be used.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/inbox/background", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: token }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Could not save the chat background.");
      }
      await refreshProfile();
      toast.success("Chat background updated for your team.");
    } catch (err) {
      console.error("[chat-background] save error:", err);
      toast.error(
        err instanceof Error ? err.message : "Could not save the chat background.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquare className="size-4 text-muted-foreground" />
          Chat background
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The default wallpaper behind every conversation in the inbox.
          Shared with your team and saved to the workspace. Admins can also
          override it for an individual chat from the conversation header.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Live preview */}
        <div
          className={cn(
            "relative hidden h-40 w-56 shrink-0 overflow-hidden rounded-xl border border-border sm:block",
            preview.className,
          )}
          style={preview.style}
          aria-hidden
        >
          <div className="absolute bottom-3 left-3 max-w-[70%] rounded-lg rounded-bl-sm bg-muted px-3 py-1.5 text-xs text-foreground shadow-sm">
            Hi there 👋
          </div>
          <div className="absolute bottom-10 right-3 max-w-[70%] rounded-lg rounded-br-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-sm">
            How can we help?
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <ChatBackgroundPicker
            value={current}
            onSelect={handleSelect}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}
