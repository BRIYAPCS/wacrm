"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/**
 * A single "new messages" entry in the notification bell — one row per
 * conversation that currently has unread inbound messages.
 */
export interface MessageAlert {
  conversationId: string;
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  contactName: string;
}

interface RawConversationRow {
  id: string;
  unread_count: number | null;
  last_message_text: string | null;
  last_message_at: string | null;
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
}

const LIMIT = 8;

/**
 * Loads the two lists shown in the notification bell — unread
 * conversations ("messages") and recent app notifications ("alerts").
 *
 * Deliberately lazy: the lists are fetched only while the panel is `open`,
 * and re-fetched whenever `changeSignal` moves. The caller passes the sum
 * of the live unread counts (from `useTotalUnread` + `useUnreadNotifications`,
 * which already run their own realtime subscriptions) as that signal — so a
 * new message or alert refreshes the open panel without this hook opening a
 * third subscription of its own.
 */
export function useNotificationPanel(open: boolean, changeSignal: number) {
  const [messages, setMessages] = useState<MessageAlert[]>([]);
  const [alerts, setAlerts] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Monotonic request id so an earlier fetch that resolves late can't
  // clobber a newer one's results (rapid changeSignal bumps overlap loads).
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const supabase = createClient();
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const [conv, notif] = await Promise.all([
        supabase
          .from("conversations")
          .select(
            "id, unread_count, last_message_text, last_message_at, contact:contacts(name, phone)",
          )
          .gt("unread_count", 0)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(LIMIT),
        supabase
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(LIMIT),
      ]);

      // A newer load started while we were awaiting — drop these results.
      if (seq !== reqSeq.current) return;

      if (!conv.error && conv.data) {
        setMessages(
          (conv.data as RawConversationRow[]).map((c) => {
            const contact = Array.isArray(c.contact) ? c.contact[0] : c.contact;
            return {
              conversationId: c.id,
              unreadCount: c.unread_count ?? 0,
              lastMessageText: c.last_message_text,
              lastMessageAt: c.last_message_at,
              contactName: contact?.name || contact?.phone || "Unknown",
            };
          }),
        );
      }
      if (!notif.error && notif.data) {
        setAlerts(notif.data as Notification[]);
      }
    } finally {
      // Only the latest request owns the loading/loaded flags.
      if (seq === reqSeq.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, changeSignal, load]);

  /** Optimistically mark one alert read (server write is fire-and-forget). */
  const markAlertRead = useCallback(async (id: string) => {
    setAlerts((prev) =>
      prev.map((n) =>
        n.id === id && !n.read_at
          ? { ...n, read_at: new Date().toISOString() }
          : n,
      ),
    );
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
  }, []);

  /** Mark every unread alert read. */
  const markAllAlertsRead = useCallback(async () => {
    const now = new Date().toISOString();
    setAlerts((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }, []);

  return { messages, alerts, loading, loaded, reload: load, markAlertRead, markAllAlertsRead };
}
