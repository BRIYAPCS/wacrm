"use client";

import * as React from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { AVAILABILITY_META, type Availability } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ORDER: Availability[] = ["available", "away", "busy", "out_of_office"];

/** datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function AvailabilityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { profile, refreshProfile } = useAuth();
  const [status, setStatus] = React.useState<Availability>("available");
  const [note, setNote] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Seed from the current profile each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setStatus((profile?.availability as Availability) ?? "available");
    setNote(profile?.availability_note ?? "");
    setUntil(
      profile?.availability_until ? toLocalInput(profile.availability_until) : "",
    );
  }, [open, profile]);

  async function save() {
    if (!profile) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        availability: status,
        availability_note: status === "available" ? null : note.trim() || null,
        availability_until:
          status !== "available" && until
            ? new Date(until).toISOString()
            : null,
      })
      .eq("id", profile.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't update your status");
      return;
    }
    await refreshProfile();
    toast.success("Availability updated");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set your availability</DialogTitle>
          <DialogDescription>
            Away and Out of office gray you out (not newly assignable) in the
            Assign-to list and show a banner on your chats.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {ORDER.map((s) => {
              const meta = AVAILABILITY_META[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    status === s
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                  {meta.label}
                </button>
              );
            })}
          </div>

          {status !== "available" && (
            <>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Note (optional)
                </label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. On PTO, back Monday"
                  maxLength={140}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Back on (optional)
                </label>
                <Input
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  After this time your status returns to Available
                  automatically.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
