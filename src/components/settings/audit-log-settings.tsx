'use client';

// ============================================================
// Settings → Audit log (admin+).
//
// Read-only view of the account's audit trail, newest first, with
// cursor pagination ("Load more"). The API (requireRole('admin')) is the
// real gate — a non-admin gets a 403 which we render as a friendly
// notice rather than an error.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  ScrollText,
  UserCog,
  UserMinus,
  UserPlus,
  Crown,
  Phone,
  Star,
  Pencil,
  Trash2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Skeleton } from '@/components/dashboard/skeleton';

interface AuditEvent {
  id: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Per-action presentation: icon + a sentence builder. Unknown actions
// fall back to the raw key so a newly-instrumented event still renders.
const ACTION_META: Record<
  string,
  { icon: LucideIcon; label: (m: Record<string, unknown>) => string }
> = {
  'member.role_changed': {
    icon: UserCog,
    label: (m) => `changed a member's role to ${str(m.new_role) || 'a new role'}`,
  },
  'member.removed': { icon: UserMinus, label: () => 'removed a member from the account' },
  'invitation.created': {
    icon: UserPlus,
    label: (m) => `invited a new ${str(m.role) || 'member'}`,
  },
  'invitation.revoked': { icon: UserMinus, label: () => 'revoked a pending invitation' },
  'ownership.transferred': { icon: Crown, label: () => 'transferred account ownership' },
  'whatsapp_number.added': {
    icon: Phone,
    label: (m) => `connected a WhatsApp number${m.label ? ` (${str(m.label)})` : ''}`,
  },
  'whatsapp_number.removed': { icon: Trash2, label: () => 'removed a WhatsApp number' },
  'whatsapp_number.default_changed': {
    icon: Star,
    label: () => 'changed the default WhatsApp number',
  },
  'whatsapp_number.renamed': { icon: Pencil, label: () => 'renamed a WhatsApp number' },
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function AuditLogSettings() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (before: string | null) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (before) qs.set('before', before);
    const res = await fetch(`/api/account/audit?${qs.toString()}`);
    if (res.status === 403) {
      setForbidden(true);
      return null;
    }
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? 'Failed to load audit log');
      return null;
    }
    return res.json() as Promise<{
      events: AuditEvent[];
      hasMore: boolean;
      nextBefore: string | null;
    }>;
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await fetchPage(null);
      if (data) {
        setEvents(data.events);
        setHasMore(data.hasMore);
        setNextBefore(data.nextBefore);
      }
      setLoading(false);
    })();
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    const data = await fetchPage(nextBefore);
    if (data) {
      setEvents((prev) => [...prev, ...data.events]);
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
    }
    setLoadingMore(false);
  };

  if (forbidden) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Admins only</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            The audit log is visible to account owners and admins. Ask an admin
            if you need to review recent account changes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          A record of sensitive account changes — team members, invitations,
          ownership, and WhatsApp numbers. Newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No activity yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Account-administration actions will appear here as they happen.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {events.map((e) => {
                const meta = ACTION_META[e.action];
                const Icon = meta?.icon ?? ScrollText;
                const sentence = meta ? meta.label(e.metadata ?? {}) : e.action;
                const actor = e.actor_label || 'A team member';
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{actor}</span>{' '}
                        <span className="text-muted-foreground">{sentence}</span>
                      </p>
                      <p
                        className="mt-0.5 text-xs text-muted-foreground"
                        title={format(new Date(e.created_at), 'PPpp')}
                      >
                        {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </>
                  ) : (
                    'Load more'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
