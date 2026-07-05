"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (qrRef.current) clearInterval(qrRef.current);
    pollRef.current = qrRef.current = null;
  }, []);

  const refreshQr = useCallback(async () => {
    const res = await fetch(`/api/whatsapp/link/${numberId}/qr`);
    const data = (await res.json().catch(() => null)) as
      | { connected?: boolean; qr?: string | null }
      | null;
    if (data?.connected) {
      setConnected(true);
      stop();
      onConnected();
    } else if (data?.qr) {
      setQr(data.qr);
    }
  }, [numberId, stop, onConnected]);

  useEffect(() => {
    if (!open) return;
    // Fresh mount each time the dialog opens (parent keys on numberId), so
    // initial state is already clean — just start pairing. State updates
    // here happen only after an async fetch, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshQr();
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/whatsapp/link/${numberId}`);
      const data = (await res.json().catch(() => null)) as { connected?: boolean } | null;
      if (data?.connected) {
        setConnected(true);
        stop();
        onConnected();
      }
    }, 3000);
    qrRef.current = setInterval(() => void refreshQr(), 20000);
    return stop;
  }, [open, numberId, refreshQr, stop, onConnected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Link your WhatsApp number</DialogTitle>
          <DialogDescription>
            On your phone, open WhatsApp → Linked devices → Link a device, and scan this code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {connected ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium text-foreground">Connected</p>
            </>
          ) : qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="WhatsApp pairing QR code" className="h-56 w-56 rounded-lg bg-white p-2" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {!connected && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for you to scan…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
