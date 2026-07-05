"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import {
  presenceLabel,
  effectiveAvailability,
  AVAILABILITY_META,
} from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  ConversationEvent,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  Wallpaper,
  Users,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { ConversationNumberBadge } from "./number-badge";
import { ConversationNotes } from "./conversation-notes";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { ChatBackgroundPicker } from "./chat-background-picker";
import {
  backgroundStyle,
  resolveBackgroundToken,
} from "@/lib/inbox/backgrounds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
  /**
   * Mobile/tablet (<lg) contact-info opener. On small screens the contact
   * sidebar can't sit beside the thread, so the page opens it in a Sheet;
   * this button (rendered lg:hidden) is the only way to reach a contact's
   * tags / deals / notes on touch devices.
   */
  onOpenContactInfo?: () => void;
  /**
   * Fired after a per-conversation chat-background change so the parent
   * can optimistically patch its conversation copy (realtime converges it
   * too). Optional — the control is admin-only and only rendered when the
   * caller can edit settings.
   */
  onBackgroundChange?: (
    conversationId: string,
    background: string | null,
  ) => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

// A unified thread timeline: messages and action-history events interleaved
// by time, so a "transferred to X" line sits exactly where it happened.
type TimelineEntry =
  | { kind: "message"; at: string; msg: Message }
  | { kind: "event"; at: string; event: ConversationEvent };

function groupTimelineByDate(entries: TimelineEntry[]) {
  const groups: { date: string; entries: TimelineEntry[] }[] = [];
  let currentDate = "";
  for (const e of entries) {
    const day = format(new Date(e.at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: e.at, entries: [e] });
    } else {
      groups[groups.length - 1].entries.push(e);
    }
  }
  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-muted-foreground" },
];

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
  onOpenContactInfo,
  onBackgroundChange,
}: MessageThreadProps) {
  const { user, profile, account, canEditSettings, canSendMessages } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ticking clock so the 24-hour window advances with real time, not only
  // when `messages` changes — otherwise a thread left open across the boundary
  // keeps showing a live composer well past expiry (and vice-versa).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // 24-hour session timer.
  const sessionInfo = useMemo(() => {
    // Find last customer (inbound) message.
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    // No inbound message → there is no open 24h window, so the free-text
    // composer must be closed (template-only). Covers a brand-new thread and
    // an agent-only thread alike.
    if (!lastCustomerMsg) {
      return {
        expired: true,
        remaining: messages.length ? "No customer messages" : "",
      };
    }

    // Millisecond delta (differenceInHours truncates, drifting up to ~1h).
    const hoursSince =
      (nowTs - new Date(lastCustomerMsg.created_at).getTime()) / 3_600_000;
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expired" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.max(1, Math.floor(hoursLeft * 60))}m remaining`;

    return { expired, remaining };
  }, [messages, nowTs]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // --- Action-history events (assign / transfer / status change) ---
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("conversation_events")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setEvents((data as ConversationEvent[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation?.id]);

  const logEvent = useCallback(
    async (
      eventType: ConversationEvent["event_type"],
      meta: ConversationEvent["meta"],
    ) => {
      if (!conversation || !account?.id) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversation_events")
        .insert({
          conversation_id: conversation.id,
          account_id: account.id,
          event_type: eventType,
          actor_id: user?.id ?? null,
          meta: meta ?? {},
        })
        .select("*")
        .single();
      if (!error && data) {
        setEvents((prev) => [...prev, data as ConversationEvent]);
      }
    },
    [conversation, account?.id, user?.id],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      // Check the write before optimistically flipping — a viewer (RLS),
      // network failure, etc. would otherwise show a status the DB never took.
      const { error } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);
      if (error) {
        toast.error("Failed to update status");
        return;
      }

      onStatusChange(conversation.id, status);
      void logEvent("status_changed", { to_status: status });
    },
    [conversation, onStatusChange, logEvent]
  );

  // Per-conversation chat background (owner/admin only). Persisted via a
  // role-gated route (the shared conversations UPDATE RLS is agent+, so
  // admin-only enforcement lives server-side); the optimistic callback +
  // realtime UPDATE converge the open thread.
  const [bgDialogOpen, setBgDialogOpen] = useState(false);
  const [bgSaving, setBgSaving] = useState(false);
  const handleBackgroundSelect = useCallback(
    async (token: string | null) => {
      if (!conversation) return;
      setBgSaving(true);
      try {
        const res = await fetch(
          `/api/inbox/conversations/${conversation.id}/background`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ background: token }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "Could not update the background.");
        }
        onBackgroundChange?.(conversation.id, token);
        toast.success("Chat background updated.");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not update the background.",
        );
      } finally {
        setBgSaving(false);
      }
    },
    [conversation, onBackgroundChange],
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const prevAgent = conversation.assigned_agent_id ?? null;
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
      if (agentId) {
        void logEvent("assigned", {
          to_agent_id: agentId,
          from_agent_id: prevAgent,
        });
      } else {
        void logEvent("unassigned", { from_agent_id: prevAgent });
      }
    },
    [conversation, onAssignChange, logEvent],
  );

  // Effective chat background: the conversation's own override, else the
  // account default, else the built-in doodle. Applied to both the empty
  // state and the active thread so swapping between them stays consistent.
  const chatBg = backgroundStyle(
    resolveBackgroundToken(conversation?.background, account?.inbox_background),
  );

  // Empty state — same background as the active thread below, so swapping
  // between empty/selected doesn't change the backdrop under the user's eye.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center",
          chatBg.className,
        )}
        style={chatBg.style}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const isGroup = contact.is_group === true || contact.phone.endsWith("@g.us");
  const displayName = isGroup
    ? contact.name || "Group chat"
    : contact.name || contact.phone;
  // Merge messages + action-history events into one time-ordered timeline.
  const timeline: TimelineEntry[] = [
    ...messages.map(
      (m): TimelineEntry => ({ kind: "message", at: m.created_at, msg: m }),
    ),
    ...events.map(
      (e): TimelineEntry => ({ kind: "event", at: e.created_at, event: e }),
    ),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const timelineGroups = groupTimelineByDate(timeline);

  // Teams-style run headers: the sender's name shows above the FIRST message of
  // each consecutive run from the same sender (a new run also starts after a
  // >5-min gap, or after an action-history event). This is what makes
  // multi-agent threads legible — you can see which agent sent which reply.
  const RUN_GAP_MS = 5 * 60 * 1000;
  const senderNameFor = (m: Message): string => {
    if (m.sender_type === "bot") return "AI assistant";
    if (m.sender_type === "agent") {
      const p = profiles.find((pr) => pr.user_id === m.sender_id);
      return p?.full_name || "Agent";
    }
    if (isGroup) return m.sender_name || m.sender_phone || "Member";
    return contact.name || contact.phone || "Customer";
  };
  const startsRun = (m: Message, prev: Message | null): boolean => {
    if (!prev) return true;
    if (prev.sender_type !== m.sender_type) return true;
    if (m.sender_type === "agent" && prev.sender_id !== m.sender_id) return true;
    if (
      isGroup &&
      m.sender_type === "customer" &&
      (prev.sender_phone ?? "") !== (m.sender_phone ?? "")
    )
      return true;
    const gap =
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime();
    return gap > RUN_GAP_MS;
  };

  // Precompute which messages start a run (an event resets the run).
  const startsRunById = new Map<string, boolean>();
  {
    let prev: Message | null = null;
    for (const e of timeline) {
      if (e.kind === "event") {
        prev = null;
        continue;
      }
      startsRunById.set(e.msg.id, startsRun(e.msg, prev));
      prev = e.msg;
    }
  }

  // Human-readable action-history line ("Ana transferred this to Beto").
  const nameForUser = (uid?: string | null): string => {
    if (!uid) return "Someone";
    if (uid === user?.id) return "You";
    return profiles.find((p) => p.user_id === uid)?.full_name ?? "A teammate";
  };
  const describeEvent = (ev: ConversationEvent): string => {
    const actor = nameForUser(ev.actor_id);
    if (ev.event_type === "status_changed") {
      const label =
        STATUS_OPTIONS.find((s) => s.value === ev.meta?.to_status)?.label ??
        ev.meta?.to_status ??
        "updated";
      return `${actor} marked this ${label.toLowerCase()}`;
    }
    if (ev.event_type === "unassigned") {
      const from = ev.meta?.from_agent_id
        ? ` from ${nameForUser(ev.meta.from_agent_id)}`
        : "";
      return `${actor} unassigned this${from}`;
    }
    const to = nameForUser(ev.meta?.to_agent_id);
    return ev.meta?.from_agent_id
      ? `${actor} transferred this from ${nameForUser(ev.meta.from_agent_id)} to ${to}`
      : `${actor} assigned this to ${to}`;
  };

  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";
  // Out-of-office / Away banner for the assigned agent (Teams-style).
  const assigneeAvailability = currentAssignee
    ? effectiveAvailability(currentAssignee, now)
    : "available";
  const showAssigneeBanner =
    !!currentAssignee && !AVAILABILITY_META[assigneeAvailability].assignable;

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div
      className={cn("flex min-w-0 flex-1 flex-col", chatBg.className)}
      style={chatBg.style}
    >
      {/* Header — solid card surface sits on top of the wallpaper so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground">
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary-host WhatsApp CDN avatar URL; next/image would need an open remotePatterns allowlist
              <img
                src={contact.avatar_url}
                alt={displayName}
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : isGroup ? (
              <Users className="h-4 w-4" />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs text-muted-foreground">
                {isGroup ? "Group chat" : contact.phone}
              </p>
              <ConversationNumberBadge
                configId={conversation.whatsapp_config_id ?? null}
              />
            </div>
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. */}
          <Badge
            variant="outline"
            className={cn(
              "ml-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",
              sessionInfo.expired ? "text-red-400" : "text-primary"
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Contact-info opener — mobile/tablet only (<lg). The contact
              sidebar can't sit beside the thread on narrow screens, so this
              opens it in a Sheet; without it, tags/deals/notes are
              unreachable on touch devices. */}
          {onOpenContactInfo && (
            <button
              type="button"
              onClick={onOpenContactInfo}
              aria-label="Show contact info"
              title="Contact info"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}

          {/* Contact-panel toggle — desktop only. The contact sidebar
              eats a chunk of horizontal width that crowds the thread on
              smaller laptops; this lets agents reclaim it when they just
              want to read and reply. Hidden on mobile, where the sidebar
              never renders as a permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? "Hide contact panel" : "Show contact panel"
              }
              aria-pressed={contactPanelOpen}
              title={contactPanelOpen ? "Hide contact" : "Show contact"}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground lg:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Chat background — owner/admin only. Opens the wallpaper
              picker for THIS conversation (overrides the account default). */}
          {canEditSettings && (
            <button
              type="button"
              onClick={() => setBgDialogOpen(true)}
              aria-label="Change chat background"
              title="Change chat background"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Wallpaper className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Status dropdown — mutates the conversation, so viewers (read-only)
              can't use it (the DB rejects their write too; this stops the
              optimistic flip from ever showing). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!canSendMessages}
              title={canSendMessages ? undefined : "Read-only"}
              className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                {currentStatus?.label ?? "Status"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown — mutating; viewers are read-only. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!canSendMessages}
              title={canSendMessages ? undefined : "Read-only"}
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  const avail = effectiveAvailability(p, now);
                  const availMeta = AVAILABILITY_META[avail];
                  // Away / Out-of-office agents show grayed-out and can't be
                  // newly assigned to (the selected one stays visible so you
                  // can still reassign AWAY from them).
                  const assignable = availMeta.assignable;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      disabled={!assignable && !isSelected}
                      onClick={() => {
                        if (assignable) handleAssignChange(p.user_id);
                      }}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground",
                        !assignable && "opacity-50"
                      )}
                    >
                      {avail === "available" ? (
                        <PresenceDot
                          status={presence}
                          label={presenceLabel(
                            presence,
                            getRow(p.user_id)?.last_seen_at ?? null,
                            now
                          )}
                          className="mr-2"
                        />
                      ) : (
                        <span
                          title={availMeta.label}
                          className={cn(
                            "mr-2 inline-block h-2 w-2 shrink-0 rounded-full",
                            availMeta.dot
                          )}
                        />
                      )}
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {avail !== "available" && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {availMeta.label}
                        </span>
                      )}
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {timelineGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Timeline: messages + action-history events */}
                <div className="space-y-2">
                  {group.entries.map((entry) => {
                    if (entry.kind === "event") {
                      const ev = entry.event;
                      return (
                        <div
                          key={ev.id}
                          className="my-2 flex items-center justify-center"
                        >
                          <span className="rounded-full bg-muted/60 px-3 py-1 text-center text-[10px] text-muted-foreground">
                            {describeEvent(ev)} ·{" "}
                            {format(new Date(ev.created_at), "h:mm a")}
                          </span>
                        </div>
                      );
                    }

                    const msg = entry.msg;
                    const showSender = startsRunById.get(msg.id) ?? true;
                    const isAgentMsg =
                      msg.sender_type === "agent" || msg.sender_type === "bot";
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <div key={msg.id}>
                        {showSender && (
                          <div
                            className={cn(
                              "mb-0.5 px-1 text-xs font-medium text-muted-foreground",
                              isAgentMsg ? "text-right" : "text-left"
                            )}
                          >
                            {senderNameFor(msg)}
                          </div>
                        )}
                        <MessageActions
                          message={msg}
                          onReply={() => handleStartReply(msg)}
                          onReact={(emoji) => {
                            if (emoji) void postReaction(msg.id, emoji);
                          }}
                        >
                          <MessageBubble
                            message={msg}
                            reply={reply}
                            reactions={msgReactions}
                            currentUserId={user?.id}
                            onToggleReaction={handlePillToggle}
                          />
                        </MessageActions>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      {showAssigneeBanner && currentAssignee && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-1.5 sm:mx-4">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              AVAILABILITY_META[assigneeAvailability].dot
            )}
          />
          <p className="text-xs text-primary">
            {currentAssignee.full_name} is{" "}
            {AVAILABILITY_META[assigneeAvailability].label.toLowerCase()} and may
            not respond
            {currentAssignee.availability_note
              ? ` — ${currentAssignee.availability_note}`
              : ""}
          </p>
        </div>
      )}
      <ConversationNotes
        conversationId={conversation.id}
        members={profiles}
        currentUserId={user?.id ?? null}
      />

      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        isGroup={isGroup}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        mergeContext={{
          contact: {
            name: contact.name,
            phone: contact.phone,
            company: contact.company,
            email: contact.email,
          },
          agent: { name: profile?.full_name ?? null },
          account: { name: account?.name ?? null },
        }}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      {/* Per-conversation chat-background picker (owner/admin only). */}
      {canEditSettings && (
        <Dialog open={bgDialogOpen} onOpenChange={setBgDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Chat background</DialogTitle>
              <DialogDescription>
                Set the wallpaper for this conversation. It overrides the
                account default for everyone on your team viewing this chat.
              </DialogDescription>
            </DialogHeader>
            <ChatBackgroundPicker
              value={conversation.background ?? null}
              onSelect={handleBackgroundSelect}
              saving={bgSaving}
              allowInherit
              inheritPreviewToken={resolveBackgroundToken(
                null,
                account?.inbox_background,
              )}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
