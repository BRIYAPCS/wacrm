"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { findExistingContact } from "@/lib/contacts/dedupe";
import { isValidE164, sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";
import type { Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Start a conversation with ANY number — saves it as a contact if it isn't
 * one yet, then opens the thread so the agent can message it. Covers "send to
 * a number that isn't stored."
 */
export function NewChatDialog({
  onCreated,
}: {
  onCreated: (conversation: Conversation) => void;
}) {
  const { profile, account } = useAuth();
  const canSend = useCan("send-messages");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!canSend) return null;

  async function start() {
    const accountId = account?.id;
    if (!accountId || !profile) return;

    const digits = sanitizePhoneForMeta(phone);
    if (!isValidE164(digits)) {
      toast.error("Enter a valid phone number with its country code.");
      return;
    }
    const e164 = phone.startsWith("+") ? phone : `+${digits}`;

    setSaving(true);
    try {
      const supabase = createClient();

      // 1) Find or create the contact (dedup on normalized phone).
      let contactId: string;
      const existing = await findExistingContact(supabase, accountId, e164);
      if (existing) {
        contactId = existing.id;
        if (name.trim() && name.trim() !== existing.name) {
          await supabase
            .from("contacts")
            .update({ name: name.trim() })
            .eq("id", contactId);
        }
      } else {
        const authUserId = (await supabase.auth.getUser()).data.user?.id;
        const { data: created, error } = await supabase
          .from("contacts")
          .insert({
            account_id: accountId,
            user_id: authUserId,
            phone: e164,
            name: name.trim() || null,
          })
          .select("id")
          .single();
        if (error || !created) {
          toast.error("Couldn't save the contact.");
          setSaving(false);
          return;
        }
        contactId = created.id;
      }

      // 2) Find or create the conversation for that contact.
      const { data: convRow } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .maybeSingle();

      let conversation = convRow as Conversation | null;
      if (!conversation) {
        const authUserId = (await supabase.auth.getUser()).data.user?.id;
        const { data: newConv, error } = await supabase
          .from("conversations")
          .insert({
            account_id: accountId,
            user_id: authUserId,
            contact_id: contactId,
          })
          .select("*, contact:contacts(*)")
          .single();
        if (error || !newConv) {
          toast.error("Couldn't start the conversation.");
          setSaving(false);
          return;
        }
        conversation = newConv as Conversation;
      }

      onCreated(conversation);
      setOpen(false);
      setPhone("");
      setName("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
        title="Message a new number"
      >
        <Plus className="h-3.5 w-3.5" />
        New chat
      </Button>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Message any WhatsApp number. It&apos;s saved as a contact if it
            isn&apos;t one already.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nc-phone" className="text-muted-foreground">
              Phone <span className="text-red-400">*</span>
            </Label>
            <PhoneInput id="nc-phone" value={phone} onChange={setPhone} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-name" className="text-muted-foreground">
              Name (optional)
            </Label>
            <Input
              id="nc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={start} disabled={saving || !phone}>
            {saving ? "Starting…" : "Start chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
