"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, QrCode, Smartphone, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Phase = "form" | "pairing" | "connected";

export function WsapiConnect() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [instanceId, setInstanceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/wsapi/webhook` : "";

  const stopTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (qrRef.current) clearInterval(qrRef.current);
    pollRef.current = null;
    qrRef.current = null;
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const reset = () => {
    stopTimers();
    setPhase("form");
    setInstanceId("");
    setApiKey("");
    setLabel("");
    setQr(null);
    setBusy(false);
  };

  const finishConnected = useCallback(() => {
    stopTimers();
    setPhase("connected");
    window.dispatchEvent(new Event("wa-config-changed"));
    toast.success("WhatsApp number connected via wsapi.chat");
  }, [stopTimers]);

  const refreshQr = useCallback(async (id: string) => {
    const res = await fetch(`/api/whatsapp/wsapi/${id}/qr`);
    const data = (await res.json().catch(() => null)) as
      | { connected?: boolean; qr?: string | null; error?: string }
      | null;
    if (!res.ok) return;
    if (data?.connected) finishConnected();
    else if (data?.qr) setQr(data.qr);
  }, [finishConnected]);

  const startPairing = useCallback(
    (id: string) => {
      setPhase("pairing");
      void refreshQr(id);
      // Poll connection status; refresh the QR (it expires) less often.
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/whatsapp/wsapi/${id}`);
        const data = (await res.json().catch(() => null)) as { connected?: boolean } | null;
        if (data?.connected) finishConnected();
      }, 3000);
      qrRef.current = setInterval(() => void refreshQr(id), 20000);
    },
    [refreshQr, finishConnected],
  );

  const connect = async () => {
    if (!instanceId.trim() || !apiKey.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/wsapi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instanceId.trim(),
          apiKey: apiKey.trim(),
          label: label.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { number?: { id: string }; connected?: boolean; error?: string; code?: string }
        | null;
      if (!res.ok || !data?.number) {
        throw new Error(data?.error ?? "Could not connect that instance.");
      }
      if (data.connected) finishConnected();
      else startPairing(data.number.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Connect via wsapi.chat (QR)
          </CardTitle>
          <CardDescription>
            Add a WhatsApp number by scanning a QR code — no Meta Business
            account needed. Create an instance in your{" "}
            <a
              href="https://wsapi.chat"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              wsapi.chat
            </a>{" "}
            dashboard, then paste its Instance ID + API key here and scan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            <QrCode className="h-4 w-4" /> Add number via wsapi.chat
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a wsapi.chat number</DialogTitle>
            <DialogDescription>
              {phase === "form" && "Paste your instance credentials, then scan the QR with WhatsApp."}
              {phase === "pairing" && "Open WhatsApp → Linked devices → Link a device, and scan this code."}
              {phase === "connected" && "Connected! You can now send and receive on this number."}
            </DialogDescription>
          </DialogHeader>

          {phase === "form" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Instance ID</label>
                <Input
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value)}
                  placeholder="ins_…"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">API key</label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_…"
                  type="password"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Label (optional)</label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Sales"
                  maxLength={60}
                  className="mt-1"
                />
              </div>
              <Button onClick={connect} disabled={busy || !instanceId.trim() || !apiKey.trim()} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
              </Button>
              <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                To receive messages, set your wsapi.chat instance&apos;s webhook to:
                <br />
                <code className="break-all text-foreground">{webhookUrl}</code>
              </p>
            </div>
          )}

          {phase === "pairing" && (
            <div className="flex flex-col items-center gap-3 py-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt="WhatsApp pairing QR code"
                  className="h-56 w-56 rounded-lg bg-white p-2"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for you to scan…
              </p>
            </div>
          )}

          {phase === "connected" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium text-foreground">Number connected</p>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
