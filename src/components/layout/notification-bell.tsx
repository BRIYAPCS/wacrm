"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AtSign,
  Bell,
  CheckCheck,
  Loader2,
  MessageSquare,
  UserPlus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Notification } from "@/types";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  useNotificationPanel,
  type MessageAlert,
} from "@/hooks/use-notification-panel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const ALERT_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
  mention: AtSign,
};

/**
 * Global live-notification bell for the app header. One badge unifies two
 * live signals — conversations with unread messages and unread app alerts
 * (assignments / mentions) — both already realtime via their own hooks.
 * The dropdown lazy-loads the matching lists and refreshes whenever either
 * count changes, so it stays live without opening another subscription.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const unreadChats = useTotalUnread();
  const unreadAlerts = useUnreadNotifications();
  const total = unreadChats + unreadAlerts;

  const { messages, alerts, loading, loaded, markAlertRead, markAllAlertsRead } =
    useNotificationPanel(open, total);

  const badge = total > 9 ? "9+" : String(total);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const handleAlertClick = (n: Notification) => {
    if (!n.read_at) void markAlertRead(n.id);
    if (n.conversation_id) go(`/inbox?c=${n.conversation_id}`);
    else setOpen(false);
  };

  const isEmpty = useMemo(
    () => messages.length === 0 && alerts.length === 0,
    [messages.length, alerts.length],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted/70"
        aria-label={
          total > 0 ? `Notifications, ${total} unread` : "Notifications"
        }
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background">
            {badge}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(360px,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            Notifications
          </span>
          {unreadAlerts > 0 && (
            <button
              type="button"
              onClick={() => void markAllAlertsRead()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[min(70vh,28rem)] overflow-y-auto">
          {!loaded && loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">
                New messages and alerts will show up here.
              </p>
            </div>
          ) : (
            <>
              {messages.length > 0 && (
                <Section label="Messages">
                  {messages.map((m) => (
                    <MessageRow
                      key={m.conversationId}
                      alert={m}
                      onClick={() => go(`/inbox?c=${m.conversationId}`)}
                    />
                  ))}
                </Section>
              )}

              {alerts.length > 0 && (
                <Section label="Alerts">
                  {alerts.map((n) => (
                    <AlertRow key={n.id} alert={n} onClick={() => handleAlertClick(n)} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border p-1.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted"
          >
            See all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function MessageRow({ alert, onClick }: { alert: MessageAlert; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <MessageSquare className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {alert.contactName}
            </span>
            <span className="ml-auto flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {alert.unreadCount > 9 ? "9+" : alert.unreadCount}
            </span>
          </span>
          {alert.lastMessageText && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {alert.lastMessageText}
            </span>
          )}
          {alert.lastMessageAt && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(alert.lastMessageAt), { addSuffix: true })}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function AlertRow({ alert, onClick }: { alert: Notification; onClick: () => void }) {
  const Icon = ALERT_ICON[alert.type] ?? Bell;
  const isUnread = !alert.read_at;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60",
          isUnread && "bg-primary/5",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
            isUnread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                isUnread ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {alert.title}
            </span>
            {isUnread && (
              <span
                aria-label="Unread"
                className="ml-auto h-2 w-2 flex-shrink-0 rounded-full bg-primary"
              />
            )}
          </span>
          {alert.body && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {alert.body}
            </span>
          )}
          <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
            {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
          </span>
        </span>
      </button>
    </li>
  );
}
