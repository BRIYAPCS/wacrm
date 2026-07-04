"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Workflow,
  Play,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

interface AiSummary {
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  suggested_tags: string[];
}

const SENTIMENT_CLASS: Record<AiSummary["sentiment"], string> = {
  positive: "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  neutral: "border border-border bg-muted text-muted-foreground",
  negative: "border border-red-500/30 bg-red-500/10 text-red-400",
};

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { accountId, canSendMessages } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // "Run a flow" picker state.
  const [flowPickerOpen, setFlowPickerOpen] = useState(false);
  const [activeFlows, setActiveFlows] = useState<
    { id: string; name: string; trigger_type: string }[]
  >([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);

  // AI summary state.
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [applyingTag, setApplyingTag] = useState<string | null>(null);
  const [appliedTags, setAppliedTags] = useState<Set<string>>(new Set());

  // Clear a stale summary when the agent switches conversations.
  useEffect(() => {
    setSummary(null);
    setAppliedTags(new Set());
  }, [contact?.id]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleSummarize = useCallback(async () => {
    if (!contact) return;
    setSummarizing(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.code === "ai_not_configured") {
          toast.error("AI isn't set up yet — enable it in AI Agents → Setup.");
        } else {
          toast.error(d.error || "Couldn't summarize this conversation");
        }
        return;
      }
      setSummary({
        summary: d.summary,
        sentiment: d.sentiment,
        suggested_tags: d.suggested_tags ?? [],
      });
      setAppliedTags(new Set());
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSummarizing(false);
    }
  }, [contact]);

  const handleApplyTag = useCallback(
    async (name: string) => {
      if (!contact) return;
      setApplyingTag(name);
      try {
        const res = await fetch(`/api/contacts/${contact.id}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(d.error || "Couldn't apply tag");
          return;
        }
        setAppliedTags((prev) => new Set(prev).add(name));
        await fetchContactData(); // refresh the tag chips below
        toast.success(`Tagged “${name}”`);
      } catch {
        toast.error("Could not reach the server");
      } finally {
        setApplyingTag(null);
      }
    },
    [contact, fetchContactData],
  );

  // Open the picker and (re)load the account's ACTIVE flows. Fetched on
  // open rather than on mount so browsing the inbox doesn't hit the API
  // for a feature the agent may never use.
  const openFlowPicker = useCallback(async () => {
    setFlowPickerOpen(true);
    setFlowsLoading(true);
    try {
      const res = await fetch("/api/flows", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          flows?: { id: string; name: string; status: string; trigger_type: string }[];
        };
        setActiveFlows(
          (data.flows ?? []).filter((f) => f.status === "active"),
        );
      } else {
        toast.error("Couldn't load flows");
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setFlowsLoading(false);
    }
  }, []);

  const runFlow = useCallback(
    async (flowId: string) => {
      if (!contact) return;
      setRunningFlowId(flowId);
      try {
        const res = await fetch(`/api/flows/${flowId}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: contact.id }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error || "Couldn't start the flow");
          return;
        }
        toast.success("Flow started");
        setFlowPickerOpen(false);
      } catch {
        toast.error("Could not reach the server");
      } finally {
        setRunningFlowId(null);
      }
    },
    [contact],
  );

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary-host avatar URL (pasteable from the UI); next/image would need an open remotePatterns allowlist (image-proxy abuse vector)
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* AI summary */}
          {canSendMessages && (
            <div className="mt-4">
              {!summary ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSummarize}
                  disabled={summarizing}
                >
                  {summarizing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Summarize with AI
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-left">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      AI summary
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        SENTIMENT_CLASS[summary.sentiment],
                      )}
                    >
                      {summary.sentiment}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {summary.summary}
                  </p>
                  {summary.suggested_tags.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Suggested tags
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {summary.suggested_tags.map((t) => {
                          const applied =
                            appliedTags.has(t) ||
                            tags.some(
                              (tag) => tag.name.toLowerCase() === t.toLowerCase(),
                            );
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => handleApplyTag(t)}
                              disabled={applied || applyingTag === t}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                                applied
                                  ? "border-border bg-muted text-muted-foreground"
                                  : "border-primary/40 text-primary hover:bg-primary/10",
                              )}
                            >
                              {applyingTag === t ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : applied ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Plus className="h-3 w-3" />
                              )}
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSummarize}
                      disabled={summarizing}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={() => setSummary(null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Run a flow — agent+ only (viewers can't message customers) */}
          {canSendMessages && (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={openFlowPicker}
            >
              <Workflow className="h-4 w-4" />
              Run a flow
            </Button>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No deals</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <Dialog open={flowPickerOpen} onOpenChange={setFlowPickerOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Run a flow
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start an active flow for{" "}
              <span className="font-medium">{displayName}</span>. They&apos;ll
              receive its first message right away.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {flowsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : activeFlows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active flows. Activate a flow first.
              </p>
            ) : (
              activeFlows.map((f) => (
                <button
                  key={f.id}
                  onClick={() => runFlow(f.id)}
                  disabled={runningFlowId !== null}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {runningFlowId === f.id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <Play className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
