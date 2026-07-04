'use client';

// ============================================================
// InviteMemberDialog
//
// Admin enters an email + role → the server sends a Supabase invite email
// to that address (email-pinned: only that person can accept). The invitee
// clicks the link, sets a password on /accept-invite, and lands attached to
// this account with the assigned role. No link to copy — it's emailed.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type InviteRole = 'admin' | 'agent' | 'viewer';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful send so the parent re-fetches the
   *  pending-invitations list. */
  onCreated: () => void;
}

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
];

const ROLE_DESCRIPTIONS: Record<InviteRole, string> = {
  admin:
    'Can invite teammates, manage settings, send messages, and edit data.',
  agent:
    'Can use the inbox, contacts, broadcasts, automations, and flows. No settings or member access.',
  viewer: 'Read-only access across every page. Cannot send or edit anything.',
};

const MAX_NAME_LEN = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<InviteRole>('agent');
  const [expiry, setExpiry] = useState<string>('7');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail('');
    setName('');
    setRole('agent');
    setExpiry('7');
    setSubmitting(false);
  }

  async function handleSend() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) {
      toast.error('Enter a valid email address');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: name.trim() || undefined,
          role,
          expiresInDays: Number(expiry),
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to send invitation');
        return;
      }

      toast.success(`Invitation emailed to ${trimmedEmail}`);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error('[InviteMemberDialog] send error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Invite a teammate</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            We&rsquo;ll email them a secure link to set a password and join
            this account. Only that address can accept it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground" htmlFor="invite-email">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground" htmlFor="invite-name">
              Name <span className="text-xs">(optional)</span>
            </Label>
            <Input
              id="invite-name"
              placeholder="Jane Doe"
              value={name}
              maxLength={MAX_NAME_LEN}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as InviteRole)}>
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Link valid for</Label>
            <Select value={expiry} onValueChange={(v) => v && setExpiry(v)}>
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send invitation'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
