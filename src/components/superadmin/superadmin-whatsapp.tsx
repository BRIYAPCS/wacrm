"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Plus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  WHATSAPP_PROVIDERS,
  WHATSAPP_PROVIDER_IDS,
  type WhatsAppProviderId,
} from "@/lib/whatsapp/providers/registry";

interface NumberRow {
  id: string;
  provider: WhatsAppProviderId;
  label: string | null;
  phone_number: string | null;
  status: string;
  is_default: boolean;
}

export function SuperadminWhatsapp({
  accountId,
  accountName,
  open,
  onOpenChange,
}: {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null);
  const [provider, setProvider] = useState<WhatsAppProviderId>("wsapi");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/superadmin/accounts/${accountId}/whatsapp`);
    setNumbers(res.ok ? ((await res.json()).numbers ?? []) : []);
  }, [accountId]);

  useEffect(() => {
    if (open) {
      load();
      setError(null);
      setFields({});
      setLabel("");
    }
  }, [open, load]);

  const f = (k: string) => fields[k] ?? "";
  const setF = (k: string, v: string) => setFields((p) => ({ ...p, [k]: v }));

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { provider, label };
      if (provider === "meta") {
        body.phoneNumberId = f("phoneNumberId");
        body.accessToken = f("accessToken");
        body.wabaId = f("wabaId");
      } else if (provider === "twilio") {
        body.accountSid = f("accountSid");
        body.authToken = f("authToken");
        body.from = f("from");
      } else {
        body.instanceId = f("instanceId");
        body.apiKey = f("apiKey");
      }
      const res = await fetch(`/api/superadmin/accounts/${accountId}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      setFields({});
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this number?")) return;
    await fetch(`/api/superadmin/accounts/${accountId}/whatsapp/${id}`, { method: "DELETE" });
    await load();
  };

  // A render FUNCTION (not a nested component) so typing doesn't remount the
  // input and lose focus.
  const field = (k: string, labelText: string, type?: string, placeholder?: string) => (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground">{labelText}</label>
      <Input
        value={f(k)}
        onChange={(e) => setF(k, e.target.value)}
        type={type}
        placeholder={placeholder}
        className="mt-1 h-8 text-sm"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>WhatsApp — {accountName}</DialogTitle>
          <DialogDescription>
            Provision numbers for this account. The provider is never shown to the client.
          </DialogDescription>
        </DialogHeader>

        {/* Existing numbers */}
        <div className="space-y-1">
          {numbers === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : numbers.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No numbers yet.</p>
          ) : (
            numbers.map((n) => (
              <div key={n.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{n.label || "Unnamed"}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {WHATSAPP_PROVIDERS[n.provider].label}
                </span>
                <span className={`text-xs ${n.status === "connected" ? "text-green-500" : "text-amber-500"}`}>
                  {n.status}
                </span>
                {n.phone_number && <span className="text-xs text-muted-foreground">{n.phone_number}</span>}
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  className="ml-auto text-red-400 hover:text-red-300"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add form */}
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as WhatsAppProviderId)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {WHATSAPP_PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>
                  {WHATSAPP_PROVIDERS[p].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {provider === "meta" && (
              <>
                {field("phoneNumberId", "Phone number ID")}
                {field("wabaId", "WABA ID (optional)")}
                <div className="col-span-2">{field("accessToken", "Access token", "password")}</div>
              </>
            )}
            {provider === "twilio" && (
              <>
                {field("accountSid", "Account SID")}
                {field("from", "Sender (+1415…)")}
                <div className="col-span-2">{field("authToken", "Auth token", "password")}</div>
              </>
            )}
            {provider === "wsapi" && (
              <>
                {field("instanceId", "Instance ID", undefined, "ins_…")}
                {field("apiKey", "API key", "password", "sk_…")}
              </>
            )}
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground">Label (shown to client)</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className="mt-1 h-8 text-sm" placeholder="e.g. Support" />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button onClick={add} disabled={busy} size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add number
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
