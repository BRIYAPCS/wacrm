"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";

// Monotonic per-subscription suffix. This hook is mounted in more than one
// place at once (the sidebar nav badge AND the header notification bell), so
// a FIXED channel topic would collide: Supabase returns the same channel
// instance for a given topic, and adding `postgres_changes` listeners to an
// already-`subscribe()`d channel throws. A unique topic per mount keeps the
// subscriptions independent.
let channelSeq = 0;

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar (Inbox nav dot) and the header
 * notification bell.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, unread_count");
      if (cancelled || error || !data) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data as { id: string; unread_count: number }[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
    })();

    const channel = supabase
      .channel(`total-unread-realtime-${++channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, row.unread_count ?? 0);
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const n of map.values()) if (n > 0) sum += 1;
          setTotal(sum);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return total;
}
