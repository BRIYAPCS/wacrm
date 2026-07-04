"use client";

// Landing page for the Supabase invite email link. The link carries a
// session in the URL (hash tokens), which the browser client picks up on
// load — so by the time this renders the invitee is authenticated and
// already a member of the inviting account (handle_new_user attached them).
// They just set a display name + password here, then land in the app.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageSquare, Loader2, CheckCircle2 } from "lucide-react";

type Phase = "checking" | "ready" | "invalid" | "done";

export default function AcceptInvitePage() {
  const router = useRouter();
  const supabase = createClient();

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Wait for the client to pick up the session from the invite link.
  useEffect(() => {
    let done = false;
    const apply = (session: {
      user: { email?: string; user_metadata?: Record<string, unknown> };
    } | null) => {
      if (done || !session) return;
      done = true;
      setEmail(session.user.email ?? "");
      const metaName = session.user.user_metadata?.full_name;
      if (typeof metaName === "string") setFullName(metaName);
      setPhase("ready");
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    // detectSessionInUrl runs async on init — also listen for the sign-in.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      apply(session),
    );
    // If nothing arrived, the link is bad/expired.
    const t = setTimeout(() => {
      if (!done) setPhase("invalid");
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        setError(pwErr.message);
        return;
      }
      // Set the display name + mark the invitation accepted (server, so it
      // can write the admin-only invitations row for our own user).
      await fetch("/api/account/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim() }),
      }).catch(() => {});
      setPhase("done");
      // Brief confirmation, then into the app.
      setTimeout(() => router.replace("/inbox"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquare className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">wacrm</span>
        </div>

        {phase === "checking" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Verifying your invitation…</p>
            </CardContent>
          </Card>
        )}

        {phase === "invalid" && (
          <Card>
            <CardHeader>
              <CardTitle>Invitation link invalid or expired</CardTitle>
              <CardDescription>
                This link may have already been used or timed out. Ask an admin
                to send you a fresh invitation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" render={<Link href="/login" />}>
                Go to login
              </Button>
            </CardContent>
          </Card>
        )}

        {phase === "done" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 className="h-7 w-7 text-primary" />
              <p className="text-sm font-medium text-foreground">You&rsquo;re all set!</p>
              <p className="text-xs text-muted-foreground">Taking you to your inbox…</p>
            </CardContent>
          </Card>
        )}

        {phase === "ready" && (
          <Card>
            <CardHeader>
              <CardTitle>Accept your invitation</CardTitle>
              <CardDescription>
                {email ? (
                  <>
                    You&rsquo;re joining as <span className="font-medium">{email}</span>.
                    Set a name and password to finish.
                  </>
                ) : (
                  "Set a name and password to finish setting up your account."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Doe"
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
                    </>
                  ) : (
                    "Join the team"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
