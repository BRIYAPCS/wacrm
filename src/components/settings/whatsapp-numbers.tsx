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
import { Check, Loader2, Pencil, Star, X } from 'lucide-react';
import { LinkNumberQr } from './link-number-qr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  WHATSAPP_PROVIDERS,
  type WhatsAppProviderId,
} from '@/lib/whatsapp/providers/registry';

interface NumberRow {
  id: string;
  provider: WhatsAppProviderId;
  phone_number_id: string | null;
  wsapi_instance_id: string | null;
  phone_number: string | null;
  waba_id: string | null;
  label: string | null;
  is_default: boolean;
  status: string;
  registered_at: string | null;
  connected_at: string | null;
  last_registration_error: string | null;
}

/**
 * Subtitle for a number — PROVIDER-BLIND. Tenants must not learn which
 * gateway (and therefore cost) is behind a number, so we never show the
 * provider name, credentials, or instance/phone-number IDs — only the
 * display number (if paired) or a link prompt.
 */
function subtitleFor(row: NumberRow): string {
  if (row.phone_number) return row.phone_number;
  return row.status === 'connected' ? 'Connected' : 'Not linked yet';
}

function notifyChanged() {
  window.dispatchEvent(new Event('wa-config-changed'));
}

export function WhatsAppNumbers() {
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [linkId, setLinkId] = useState<string | null>(null);

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

  // Still loading.
  if (!numbers) return null;

  // Managed model: numbers are provisioned by the platform. When there are
  // none, tell the tenant to reach out rather than exposing any setup.
  if (numbers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>
            No WhatsApp number is connected to your account yet. Contact your
            provider to get one set up.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp numbers</CardTitle>
        <CardDescription>
          {numbers.length === 1
            ? 'Your WhatsApp number. Replies go out from the number each conversation is on.'
            : `${numbers.length} WhatsApp numbers. Replies go out from the number each conversation is on; new outbound and broadcasts use the default.`}
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
                  {subtitleFor(row)}
                </p>
              </div>

              {editingId !== row.id && (
                <div className="flex items-center gap-1">
                  {/* A provisioned number that still needs the customer to
                      pair their phone (provider-blind link flow). Any QR
                      provider (wsapi, waha) shows the link button. */}
                  {!connected && WHATSAPP_PROVIDERS[row.provider]?.needsQr && (
                    <Button size="sm" onClick={() => setLinkId(row.id)}>
                      Link your number
                    </Button>
                  )}
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
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      {linkId && (
        <LinkNumberQr
          numberId={linkId}
          open={!!linkId}
          onOpenChange={(o) => !o && setLinkId(null)}
          onConnected={() => {
            load();
            notifyChanged();
          }}
        />
      )}
    </Card>
  );
}
