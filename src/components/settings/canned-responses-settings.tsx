'use client';

// ============================================================
// Settings → Saved replies (canned responses)
//
// Manage account-shared message snippets that agents insert into the
// inbox composer via `/shortcut` or the saved-replies picker. Any
// member can view; agent+ can add / edit / delete (writes are gated
// here and re-checked by the API + RLS).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Trash2, MessageSquareText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { MERGE_FIELDS } from '@/lib/canned/merge';
import { SettingsPanelHead } from './settings-panel-head';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  created_by: string | null;
  updated_at: string;
}

const EMPTY = { shortcut: '', title: '', content: '' };

export function CannedResponsesSettings() {
  const { canSendMessages } = useAuth();
  const [items, setItems] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/canned-responses', { cache: 'no-store' });
      if (!res.ok) {
        toast.error('Failed to load saved replies');
        return;
      }
      const data = (await res.json()) as { canned_responses: CannedResponse[] };
      setItems(data.canned_responses ?? []);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(item: CannedResponse) {
    setEditing(item);
    setForm({ shortcut: item.shortcut, title: item.title, content: item.content });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.shortcut.trim() || !form.title.trim() || !form.content.trim()) {
      toast.error('Shortcut, title, and content are all required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/canned-responses/${editing.id}` : '/api/canned-responses',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to save');
        return;
      }
      toast.success(editing ? 'Saved reply updated' : 'Saved reply created');
      setDialogOpen(false);
      await load();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: CannedResponse) {
    if (!window.confirm(`Delete the saved reply "${item.title}"?`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/canned-responses/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success('Saved reply deleted');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Saved replies"
        description="Reusable message snippets your team can insert in the inbox with a /shortcut. Supports merge fields like {{contact.name}}."
        action={
          <RequireRole min="agent">
            <Button onClick={openAdd}>
              <Plus className="size-4" />
              Add saved reply
            </Button>
          </RequireRole>
        }
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <MessageSquareText className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No saved replies yet.</p>
            {canSendMessages && (
              <p className="mt-1 text-xs text-muted-foreground">
                Add one, then type <span className="font-mono">/shortcut</span> in the
                inbox composer to insert it.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        /{item.shortcut}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.content}
                    </p>
                  </div>
                  <RequireRole min="agent">
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(item)}
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.id}
                        title="Delete"
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? 'Edit saved reply' : 'New saved reply'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Insert it in the inbox by typing <span className="font-mono">/{form.shortcut || 'shortcut'}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Title</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Opening hours"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Shortcut (after <span className="font-mono">/</span>)
                </label>
                <Input
                  value={form.shortcut}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      shortcut: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                    }))
                  }
                  placeholder="hours"
                  maxLength={40}
                  className="font-mono"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Message</label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Hi {{contact.name}}! We're open Mon–Fri, 9am–6pm."
                rows={4}
                maxLength={4096}
                className="bg-muted"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Merge fields:{' '}
                {MERGE_FIELDS.map((f) => (
                  <code key={f} className="mr-1 rounded bg-muted px-1">{`{{${f}}}`}</code>
                ))}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
