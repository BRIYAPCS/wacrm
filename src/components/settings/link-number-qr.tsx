"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * Tenant-facing "link your WhatsApp number" — shows a QR to scan and polls
 * until connected. Deliberately PROVIDER-BLIND: it never names the gateway
 * behind the number. Used for numbers the platform provisioned that still
 * need the customer to pair their phone.
 *
 * Three visual states so it never looks frozen:
 *   • generating — the QR is being minted (or a stale session is recovering),
 *   • qr         — a scannable code is showing,
 *   • connected  — paired.
 * Polls are setTimeout-chained (not setInterval) so a slow request can never
 * overlap the next one, and the loop self-heals if the QR expires.
 */
export function LinkNumberQr({
  numberId,
  open,
  onOpenChange,
  onConnected,
}: {
  numberId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConnected: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Latest onConnected without making the polling effect depend on it.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    if (!open) return;

    // Fresh mount each open (parent renders this only while a numberId is set),
    // so state starts clean — no synchronous reset needed here.
    let done = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const finish = () => {
      if (done) return;
      done = true;
      setConnected(true);
      onConnectedRef.current();
    };

    // QR loop — shows the code (or keeps "generating" when none yet).
    const pollQr = async () => {
      if (done) return;
      try {
        const res = await fetch(`/api/whatsapp/link/${numberId}/qr`);
        const data = (await res.json().catch(() => null)) as
          | { connected?: boolean; qr?: string | null }
          | null;
        if (data?.connected) return finish();
        if (data?.qr) setQr(data.qr);
      } catch {
        /* transient — try again below */
      }
      if (!done) timers.push(setTimeout(pollQr, 2500));
    };

    // Status loop — detects the pairing and syncs the stored number.
    const pollStatus = async () => {
      if (done) return;
      try {
        const res = await fetch(`/api/whatsapp/link/${numberId}`);
        const data = (await res.json().catch(() => null)) as
          | { connected?: boolean }
          | null;
        if (data?.connected) return finish();
      } catch {
        /* transient */
      }
      if (!done) timers.push(setTimeout(pollStatus, 3000));
    };

    void pollQr();
    void pollStatus();

    return () => {
      done = true;
      timers.forEach(clearTimeout);
    };
  }, [open, numberId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Link your WhatsApp number</DialogTitle>
          <DialogDescription>
            On your phone, open WhatsApp → Linked devices → Link a device, and
            scan this code.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {connected ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium text-foreground">Connected</p>
              <p className="text-xs text-muted-foreground">
                Your number is linked and ready to use.
              </p>
            </>
          ) : qr ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="WhatsApp pairing QR code"
                className="h-56 w-56 rounded-lg bg-white p-2"
              />
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Waiting for you to scan…
              </p>
            </>
          ) : (
            // Generating — a nice, obviously-working state (never a bare box).
            <>
              <div className="flex h-56 w-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <div className="px-4 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Generating your QR code…
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This takes a few seconds — keep this window open.
                  </p>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <ShieldCheck className="h-3.5 w-3.5" /> Secure end-to-end pairing
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
