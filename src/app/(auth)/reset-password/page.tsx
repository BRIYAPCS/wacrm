"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageSquare, CheckCircle, ArrowLeft } from "lucide-react";

const MIN_PASSWORD = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  // /auth/callback exchanges the reset code and sets the session before it
  // redirects here — verify we actually have one (else the link was bad).
  const [phase, setPhase] = useState<"checking" | "ready" | "invalid">(
    "checking",
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? "ready" : "invalid");
    });
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.replace("/dashboard"), 1200);
  };

  const shell = (title: string, body: React.ReactNode, icon = MessageSquare) => {
    const Icon = icon;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">{title}</CardTitle>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      </div>
    );
  };

  if (phase === "checking") {
    return shell(
      "Reset password",
      <p className="text-center text-sm text-muted-foreground">Loading…</p>,
    );
  }

  if (phase === "invalid") {
    return shell(
      "Link expired",
      <>
        <CardDescription className="mb-4 text-center text-muted-foreground">
          This reset link is invalid or has expired. Request a new one.
        </CardDescription>
        <Link href="/forgot-password">
          <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            Send a new link
          </Button>
        </Link>
        <Link
          href="/login"
          className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </>,
    );
  }

  if (done) {
    return shell(
      "Password updated",
      <p className="text-center text-sm text-muted-foreground">
        Signing you in…
      </p>,
      CheckCircle,
    );
  }

  return shell(
    "Choose a new password",
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-muted-foreground">
          New password
        </Label>
        <PasswordInput
          id="password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm" className="text-muted-foreground">
          Confirm password
        </Label>
        <PasswordInput
          id="confirm"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
        />
      </div>
      <Button
        type="submit"
        disabled={saving}
        className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? "Updating…" : "Update password"}
      </Button>
    </form>,
  );
}
