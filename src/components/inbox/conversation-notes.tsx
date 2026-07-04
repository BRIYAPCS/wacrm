'use client';

// ============================================================
// Internal notes panel — team-only notes on a conversation, never sent
// to the customer. Collapsible, live (realtime), with @mention
// autocomplete that notifies the mentioned teammate.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import {
  StickyNote,
  ChevronDown,
  ChevronUp,
  AtSign,
  Loader2,
  Send,
} from 'lucide-react';
import { format } from 'date-fns';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import type { Profile } from '@/types';

interface Note {
  id: string;
  body: string;
  author_user_id: string | null;
  mentioned_user_ids: string[];
  created_at: string;
}

export function ConversationNotes({
  conversationId,
  members,
  currentUserId,
}: {
  conversationId: string;
  members: Profile[];
  currentUserId: string | null;
}) {
  const canAdd = useCan('send-messages');
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  // user_id -> full_name for mentions inserted via the picker.
  const [mentioned, setMentioned] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const nameOf = useCallback(
    (uid: string | null) => {
      if (!uid) return 'Someone';
      if (uid === currentUserId) return 'You';
      return members.find((m) => m.user_id === uid)?.full_name || 'Member';
    },
    [members, currentUserId],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const d = (await res.json()) as { notes: Note[] };
        setNotes(d.notes ?? []);
      }
    } catch {
      // Non-fatal.
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates so a teammate's note appears without a refresh.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`notes:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_notes',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const n = payload.new as Note;
          setNotes((prev) => (prev.some((p) => p.id === n.id) ? prev : [...prev, n]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [conversationId]);

  const pickerMatches = useMemo(() => {
    if (!pickerOpen) return [] as Profile[];
    const q = pickerQuery.toLowerCase();
    return members
      .filter(
        (m) =>
          m.user_id !== currentUserId &&
          (m.full_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [pickerOpen, pickerQuery, members, currentUserId]);

  const insertMention = useCallback((m: Profile) => {
    const name = m.full_name || 'Member';
    // Replace the trailing "@query" the user was typing with "@Name ".
    setBody((prev) => prev.replace(/@[\p{L}\p{N}_ ]*$/u, `@${name} `));
    setMentioned((prev) => ({ ...prev, [m.user_id]: name }));
    setPickerOpen(false);
    setPickerQuery('');
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  const submit = useCallback(async () => {
    const text = body.trim();
    if (!text || submitting) return;
    // Keep only mentions whose "@Name" still appears in the final text.
    const ids = Object.entries(mentioned)
      .filter(([, name]) => text.includes(`@${name}`))
      .map(([uid]) => uid);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, mentioned_user_ids: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || 'Failed to add note');
        return;
      }
      setNotes((prev) => (prev.some((p) => p.id === d.note.id) ? prev : [...prev, d.note]));
      setBody('');
      setMentioned({});
      if (ids.length) {
        toast.success(
          `Note added — ${ids.length} teammate${ids.length > 1 ? 's' : ''} notified`,
        );
      }
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  }, [body, submitting, mentioned, conversationId]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (pickerOpen && pickerMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPickerIndex((i) => (i + 1) % pickerMatches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPickerIndex((i) => (i - 1 + pickerMatches.length) % pickerMatches.length);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          insertMention(pickerMatches[pickerIndex] ?? pickerMatches[0]);
          return;
        }
        if (e.key === 'Escape') {
          setPickerOpen(false);
          return;
        }
      }
      // Cmd/Ctrl+Enter submits (plain Enter makes a newline in a note).
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    },
    [pickerOpen, pickerMatches, pickerIndex, insertMention, submit],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setBody(v);
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
      const match = v.match(/@([\p{L}\p{N}_ ]*)$/u);
      if (match) {
        setPickerQuery(match[1]);
        setPickerIndex(0);
        setPickerOpen(true);
      } else {
        setPickerOpen(false);
      }
    },
    [],
  );

  return (
    <div className="border-t border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400"
      >
        <StickyNote className="size-4" />
        Internal notes
        {notes.length > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px]">
            {notes.length}
          </span>
        )}
        <span className="ml-auto text-amber-500/70">
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </span>
      </button>

      {open && (
        <>
          <div className="max-h-56 space-y-2 overflow-y-auto px-3 pb-2">
            {notes.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No notes yet. Anything here stays with your team — the customer
                never sees it.
              </p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/5">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {nameOf(n.author_user_id)}
                    </span>
                    <span>{format(new Date(n.created_at), 'MMM d, HH:mm')}</span>
                  </div>
                  <p className="mt-0.5 text-xs whitespace-pre-wrap text-foreground">
                    {n.body}
                  </p>
                </div>
              ))
            )}
          </div>

          {canAdd && (
            <div className="relative px-3 pb-3">
              {pickerOpen && pickerMatches.length > 0 && (
                <div className="absolute right-3 bottom-full left-3 z-20 mb-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  {pickerMatches.map((m, i) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(m);
                      }}
                      onMouseEnter={() => setPickerIndex(i)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground',
                        i === pickerIndex ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                    >
                      <AtSign className="size-3.5 text-muted-foreground" />
                      {m.full_name || 'Member'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={taRef}
                  value={body}
                  onChange={onChange}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Add an internal note… use @ to mention a teammate (⌘/Ctrl+Enter to save)"
                  className="flex-1 resize-none rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-amber-500/60"
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!body.trim() || submitting}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
