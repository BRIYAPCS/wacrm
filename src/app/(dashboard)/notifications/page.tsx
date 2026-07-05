"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useNotificationPanel } from "@/hooks/use-notification-panel";
import type { Notification } from "@/types";
import { Bell, CheckCheck, Loader2, UserPlus, AtSign, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Icon per notification type.
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
  mention: AtSign,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // "New messages" — conversations with unread inbound messages, live.
  // This is what the header bell's badge also counts, so the page and the
  // bell stay consistent (a new message shows here, not just assignments).
  const totalUnread = useTotalUnread();
  const unreadAlerts = useUnreadNotifications();
  const { messages } = useNotificationPanel(true, totalUnread + unreadAlerts);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      // Scope the channel to the account and filter server-side, and key
      // the channel name on accountId so switching accounts tears down the
      // old subscription and builds a fresh, correctly-filtered one.
      .channel(`notifications-page-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
              prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (updateErr) {
        toast.error("Failed to mark notification as read");
        load();
      }
    },
    [load],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev,
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error("Failed to mark all as read");
      load();
    }
  }, [unreadIds.length, load]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            // Soft retry — refetch in place instead of hard-reloading the app.
            setError(null);
            load();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New messages and alerts (assignments, @mentions) show up here.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadIds.length === 0 || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          Mark all as read
        </Button>
      </div>

      {/* New messages — mirrors the header bell's "Messages" section. */}
      {messages.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            New messages
          </h2>
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.conversationId}>
                <button
                  type="button"
                  onClick={() => router.push(`/inbox?c=${m.conversationId}`)}
                  className="flex w-full items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left transition-colors hover:border-primary/50"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {m.contactName}
                      </span>
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {m.unreadCount > 9 ? "9+" : m.unreadCount}
                      </span>
                    </div>
                    {m.lastMessageText && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {m.lastMessageText}
                      </p>
                    )}
                    {m.lastMessageAt && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(m.lastMessageAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {notifications.length > 0 && (
            <h2 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Alerts
            </h2>
          )}
        </div>
      )}

      {messages.length === 0 && notifications.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            You&apos;re all caught up
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            New messages and assignment alerts will show up here.
          </p>
        </div>
      ) : notifications.length === 0 ? null : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                    isUnread
                      ? "border-primary/30 bg-primary/5 hover:border-primary/50"
                      : "border-border bg-card hover:border-border/70",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                      isUnread ? "bg-primary/15" : "bg-muted",
                    )}
                    aria-hidden
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        isUnread ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm font-semibold",
                          isUnread ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>
                      {isUnread && (
                        <span
                          aria-label="Unread"
                          className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
