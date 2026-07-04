'use client';

// ============================================================
// Multi-number manager (Settings → WhatsApp).
//
// Lists every WhatsApp number connected to the account and lets an admin
// set the default, rename, or remove one. Adding a number is done with
// the connection form below (saving a new phone_number_id inserts a new
// row rather than overwriting) — this panel links to it.
//
// It talks only to the numbers API (/api/whatsapp/config/list, PATCH /
// DELETE /api/whatsapp/config) and re-fetches its own list after each
// change. It also dispatches a `wa-config-changed` window event so the
// connection form below re-hydrates when the default moves.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

interface NumberRow {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  label: string | null;
  is_default: boolean;
  status: string;
  registered_at: string | null;
  connected_at: string | null;
  last_registration_error: string | null;
}

function notifyChanged() {
  window.dispatchEvent(new Event('wa-config-changed'));
}

export function WhatsAppNumbers() {
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/config/list');
      const data = await res.json();
      setNumbers(res.ok ? (data.numbers ?? []) : []);
    } catch {
      setNumbers([]);
    }
  }, []);

  useEffect(() => {
    load();
    // Re-load when the connection form saves a (possibly new) number.
    const onChanged = () => load();
    window.addEventListener('wa-config-changed', onChanged);
    return () => window.removeEventListener('wa-config-changed', onChanged);
  }, [load]);

  const makeDefault = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_default: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed');
      toast.success('Default number updated');
      await load();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default');
    } finally {
      setBusyId(null);
    }
  };

  const saveLabel = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, label: draftLabel }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed');
      setEditingId(null);
      toast.success('Name updated');
      await load();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: NumberRow) => {
    const name = row.label || `…${row.phone_number_id.slice(-4)}`;
    if (
      !window.confirm(
        `Remove "${name}"? Conversations on this number stay in the inbox but you won't be able to reply from it until it's reconnected.`,
      )
    )
      return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/whatsapp/config?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed');
      toast.success('Number removed');
      await load();
      notifyChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setBusyId(null);
    }
  };

  // Hide the panel entirely until the account has at least one number —
  // the connection form below already covers the empty state.
  if (!numbers || numbers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected numbers</CardTitle>
        <CardDescription>
          {numbers.length === 1
            ? 'One WhatsApp number is connected. Add another below to run several numbers (e.g. Sales and Support) from one inbox.'
            : `${numbers.length} WhatsApp numbers connected. Replies go out from the number each conversation is on; new outbound and broadcasts use the default.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {numbers.map((row) => {
          const connected = row.status === 'connected';
          const busy = busyId === row.id;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500'}`}
                title={connected ? 'Connected' : 'Not connected'}
              />

              <div className="min-w-0 flex-1">
                {editingId === row.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      placeholder="e.g. Support"
                      maxLength={60}
                      className="h-8 max-w-[220px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveLabel(row.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => saveLabel(row.id)}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {row.label || 'Unnamed number'}
                    </span>
                    {row.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                )}
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  ID …{row.phone_number_id.slice(-6)}
                  {row.last_registration_error ? ' · registration incomplete' : ''}
                </p>
              </div>

              {editingId !== row.id && (
                <div className="flex items-center gap-1">
                  {!row.is_default && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => makeDefault(row.id)}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Make default'}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    title="Rename"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(row.id);
                      setDraftLabel(row.label || '');
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    title="Remove"
                    disabled={busy}
                    onClick={() => remove(row)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
