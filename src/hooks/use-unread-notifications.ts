"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

// Unique per-subscription suffix — this hook mounts in both the sidebar and
// the header notification bell at once, and a shared channel topic would
// collide (Supabase reuses the channel instance for a given topic, and you
// can't add listeners after `subscribe()`). See use-total-unread for detail.
let channelSeq = 0;

/**
 * Count of unread notifications for the current user. Used by the sidebar
 * (Notifications nav badge) and the header notification bell.
 *
 * RLS on `notifications` already scopes every read to `auth.uid() =
 * user_id`, so no explicit filter is needed here — same pattern as
 * `useTotalUnread` for conversations.
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Full reconcile against the server (head:true skips the rows, we only
    // want the count). Called on mount, on realtime re-subscribe, and on tab
    // re-focus — the incremental deltas below are best-effort, and a missed
    // (or duplicate) event would otherwise leave the badge permanently off.
    const load = async () => {
      const { count: unreadCount, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      if (cancelled || error) return;
      setCount(unreadCount ?? 0);
    };
    load();

    let subscribedOnce = false;
    const channel = supabase
      .channel(`notifications-unread-count-${++channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            if (!row.read_at) setCount((n) => n + 1);
          } else if (payload.eventType === "UPDATE") {
            // Updates here only ever set read_at (marking a notification
            // read). Derive purely from the new row so we don't rely on
            // payload.old columns, which require REPLICA IDENTITY FULL.
            const newRow = payload.new as Notification;
            if (newRow.read_at) setCount((n) => Math.max(0, n - 1));
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            if (!oldRow.read_at) setCount((n) => Math.max(0, n - 1));
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (subscribedOnce) load();
          subscribedOnce = true;
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
