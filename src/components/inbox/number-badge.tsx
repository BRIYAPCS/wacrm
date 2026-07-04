'use client';

// ============================================================
// Small header badge showing WHICH of the account's WhatsApp numbers a
// conversation is on (multi-number, migration 039). Renders nothing when
// the account has 0–1 numbers — the label only adds noise there.
//
// The numbers list is fetched once per page load and memoised at module
// scope, so dropping this badge into every open thread costs one request
// total, not one per conversation.
// ============================================================

import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';

interface NumberInfo {
  id: string;
  label: string | null;
  phone_number_id: string;
}

let cache: Promise<NumberInfo[]> | null = null;

function loadNumbers(): Promise<NumberInfo[]> {
  if (!cache) {
    cache = fetch('/api/whatsapp/config/list')
      .then((r) => (r.ok ? r.json() : { numbers: [] }))
      .then((d) => (d.numbers ?? []) as NumberInfo[])
      .catch(() => []);
  }
  return cache;
}

export function ConversationNumberBadge({ configId }: { configId?: string | null }) {
  const [numbers, setNumbers] = useState<NumberInfo[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadNumbers().then((n) => {
      if (alive) setNumbers(n);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Only meaningful once there's more than one number to disambiguate.
  if (!numbers || numbers.length < 2) return null;

  const match = configId ? numbers.find((n) => n.id === configId) : null;
  const label =
    match?.label ||
    (match ? `…${match.phone_number_id.slice(-4)}` : 'Unassigned number');

  return (
    <span
      className="inline-flex max-w-[140px] items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={`This conversation is on your "${label}" number`}
    >
      <Phone className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
