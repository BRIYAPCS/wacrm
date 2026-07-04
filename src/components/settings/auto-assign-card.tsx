'use client';

// ============================================================
// Auto-assignment card (Settings → Team members, admin+).
//
// Master toggle for round-robin assignment of new inbound conversations,
// plus a per-agent "in rotation" switch. Backed by /api/account/auto-
// assign; the actual pick happens server-side in the webhook.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Shuffle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

interface Member {
  user_id: string;
  full_name: string | null;
  account_role: string;
  assignable: boolean;
}

type Patch = { enabled?: boolean; assignable?: Record<string, boolean> };

export function AutoAssignCard() {
  const [enabled, setEnabled] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/auto-assign', { cache: 'no-store' });
      if (res.ok) {
        const d = (await res.json()) as { enabled: boolean; members: Member[] };
        setEnabled(!!d.enabled);
        setMembers(d.members ?? []);
      }
    } catch {
      // Non-fatal — card just stays hidden.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(async (payload: Patch) => {
    setSaving(true);
    try {
      const res = await fetch('/api/account/auto-assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || 'Failed to save');
        return;
      }
      setEnabled(!!d.enabled);
      setMembers(d.members ?? []);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) return null;

  const assignableCount = members.filter((m) => m.assignable).length;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Shuffle className="size-4 text-primary" />
              Auto-assign new conversations
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Round-robin inbound chats across your team so nothing sits
              unclaimed. Applies to brand-new conversations.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => patch({ enabled: v })}
            disabled={saving}
          />
        </div>

        {enabled && (
          <div className="rounded-lg border border-border">
            <p className="border-b border-border px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              In rotation
            </p>
            {members.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No agents to rotate yet — invite teammates first.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {m.full_name || 'Member'}
                      <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                        {m.account_role}
                      </span>
                    </span>
                    <Switch
                      checked={m.assignable}
                      onCheckedChange={(v) =>
                        patch({ assignable: { [m.user_id]: v } })
                      }
                      disabled={saving}
                    />
                  </li>
                ))}
              </ul>
            )}
            {members.length > 0 && assignableCount === 0 && (
              <p className="px-3 py-2 text-[11px] text-amber-400">
                No one is in the rotation — new chats won&apos;t be
                auto-assigned until you add someone.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
