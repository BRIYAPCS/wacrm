'use client';

// Compact strip above the composer listing this conversation's upcoming
// (pending) scheduled messages, each cancelable. Self-fetches; re-loads
// when `refreshKey` changes (bumped by the composer after scheduling).

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Clock, X, Loader2 } from 'lucide-react';

interface Scheduled {
  id: string;
  body: string;
  send_at: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduledMessagesStrip({
  conversationId,
  refreshKey,
  onChange,
}: {
  conversationId: string;
  refreshKey: number;
  onChange: () => void;
}) {
  const [items, setItems] = useState<Scheduled[]>([]);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/scheduled-messages?conversationId=${encodeURIComponent(conversationId)}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const d = (await res.json()) as { scheduled_messages: Scheduled[] };
        setItems(d.scheduled_messages ?? []);
      }
    } catch {
      // Non-fatal — the strip just stays empty.
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function cancel(id: string) {
    setCancelingId(id);
    try {
      const res = await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || 'Failed to cancel');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      onChange();
      toast.success('Scheduled message canceled');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setCancelingId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-2 space-y-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs"
        >
          <Clock className="size-3.5 shrink-0 text-primary" />
          <span className="shrink-0 font-medium text-foreground">{fmt(item.send_at)}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.body}</span>
          <button
            type="button"
            onClick={() => cancel(item.id)}
            disabled={cancelingId === item.id}
            aria-label="Cancel scheduled message"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
          >
            {cancelingId === item.id ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
