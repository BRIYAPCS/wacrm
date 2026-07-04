'use client';

// ============================================================
// Settings → Business hours
//
// Timezone + per-weekday open/close schedule, plus an optional away
// auto-reply for inbound messages received outside those hours. Admin+
// to edit (inputs are read-only for others). Backed by
// /api/account/business-hours; the webhook evaluates the schedule.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Clock } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import {
  coerceBusinessHours,
  DEFAULT_BUSINESS_HOURS,
  DAY_ORDER,
  DAY_LABELS,
  type BusinessHours,
  type DayKey,
} from '@/lib/business-hours';
import { SettingsPanelHead } from './settings-panel-head';

const TIMEZONES: string[] = (() => {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === 'function') return fn('timeZone');
  } catch {
    /* fall through */
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Africa/Lagos',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
})();

const inputCls =
  'rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50 disabled:opacity-60';

export function BusinessHoursSettings() {
  const { canEditSettings } = useAuth();
  const [tz, setTz] = useState('UTC');
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);
  const [awayEnabled, setAwayEnabled] = useState(false);
  const [awayMessage, setAwayMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/account/business-hours', { cache: 'no-store' });
        if (res.ok && !cancelled) {
          const d = await res.json();
          setTz(d.timezone ?? 'UTC');
          setHours(coerceBusinessHours(d.business_hours));
          setAwayEnabled(!!d.away_auto_reply_enabled);
          setAwayMessage(d.away_message ?? '');
        }
      } catch {
        /* stays on defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDay = (key: DayKey, patch: Partial<BusinessHours[DayKey]>) =>
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/account/business-hours', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: tz,
          business_hours: hours,
          away_auto_reply_enabled: awayEnabled,
          away_message: awayMessage,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || 'Failed to save');
        return;
      }
      toast.success('Business hours saved');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
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
        title="Business hours"
        description="Set your hours and an optional auto-reply for messages that arrive when you're closed."
      />

      {!canEditSettings && (
        <p className="text-xs text-muted-foreground">
          Only admins can change these settings.
        </p>
      )}

      <Card>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Timezone</label>
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              disabled={!canEditSettings}
              className={`${inputCls} w-full`}
            >
              {TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            {DAY_ORDER.map((key) => {
              const d = hours[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <Switch
                    checked={d.enabled}
                    onCheckedChange={(v) => setDay(key, { enabled: v })}
                    disabled={!canEditSettings}
                  />
                  <span className="w-24 shrink-0 text-sm text-foreground">
                    {DAY_LABELS[key]}
                  </span>
                  {d.enabled ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={d.open}
                        onChange={(e) => setDay(key, { open: e.target.value })}
                        disabled={!canEditSettings}
                        className={inputCls}
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <input
                        type="time"
                        value={d.close}
                        onChange={(e) => setDay(key, { close: e.target.value })}
                        disabled={!canEditSettings}
                        className={inputCls}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Clock className="size-4 text-primary" />
                Away auto-reply
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Automatically reply to messages that arrive outside your hours —
                once per customer per closed period. Skipped if a flow or the AI
                assistant already handles the message.
              </p>
            </div>
            <Switch
              checked={awayEnabled}
              onCheckedChange={setAwayEnabled}
              disabled={!canEditSettings}
            />
          </div>
          {awayEnabled && (
            <Textarea
              value={awayMessage}
              onChange={(e) => setAwayMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              disabled={!canEditSettings}
              placeholder="Thanks for reaching out! We're currently closed…"
              className="bg-muted"
            />
          )}
        </CardContent>
      </Card>

      {canEditSettings && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      )}
    </section>
  );
}
