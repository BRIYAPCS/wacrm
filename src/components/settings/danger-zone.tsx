'use client';

// ============================================================
// DangerZone — Settings → Team members (owner only)
//
// Permanent, irreversible teardown of the whole account. Backed by
// DELETE /api/account, which deletes the account row (cascading every
// account-scoped table) and then erases every member's login.
//
// Guard rails, in order of strength:
//   1. Rendered only inside <RequireRole min="owner"> (client gate).
//   2. The server route re-checks `requireRole('owner')` — the client
//      gate is convenience, not security.
//   3. Type-to-confirm: the destroy button stays disabled until the
//      owner types the exact account name (the GitHub pattern). This
//      makes an irreversible action impossible to trigger by reflex.
//
// On success the caller's own login no longer exists, so we hard-nav
// to /login rather than trying to use the dead session.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';

export function DangerZone() {
  const { account } = useAuth();
  const accountName = account?.name ?? '';

  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Enable the destroy button only on an exact match. Trim both sides
  // so a stray trailing space from paste doesn't block a correct name.
  const canDelete =
    accountName.length > 0 && confirmText.trim() === accountName;

  function closeDialog(next: boolean) {
    if (deleting) return; // don't let the dialog close mid-request
    setOpen(next);
    if (!next) setConfirmText('');
  }

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText.trim() }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete account');
        setDeleting(false);
        return;
      }

      // Our own auth user is gone now — the session cookie is dead.
      // Hard-navigate to /login; middleware would bounce us there anyway.
      toast.success('Account deleted');
      window.location.href = '/login';
    } catch (err) {
      console.error('[DangerZone] delete error:', err);
      toast.error('Could not reach the server');
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-4 text-red-400" />
        <h3 className="text-sm font-semibold text-foreground">Danger zone</h3>
      </div>

      <Card className="ring-red-500/40">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Delete this account
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently erases <span className="font-medium">everything</span>{' '}
              in this account — contacts, conversations, messages, deals,
              broadcasts, automations, flows, templates, API keys, and AI
              settings — and deletes the login of{' '}
              <span className="font-medium">every member</span>. This cannot be
              undone.
            </p>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className="shrink-0 bg-red-600 text-white hover:bg-red-700"
          >
            <Trash2 className="size-4" />
            Delete account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-red-400" />
              Delete “{accountName}”?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This permanently deletes the account, all of its data, and every
              member&apos;s login — including yours. This action is
              irreversible.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="confirm-account-name"
              className="text-xs text-muted-foreground"
            >
              Type <span className="font-semibold text-foreground">{accountName}</span>{' '}
              to confirm:
            </label>
            <Input
              id="confirm-account-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={accountName}
              autoComplete="off"
              disabled={deleting}
              aria-invalid={confirmText.length > 0 && !canDelete}
            />
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => closeDialog(false)}
              disabled={deleting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!canDelete || deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete account permanently'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
