// ============================================================
// GET /auth/callback — exchange an email-link `code` for a session.
//
// Supabase auth emails (password reset, signup confirmation) send the user
// here with `?code=<pkce-code>&next=<relative-path>`. We exchange the code for
// a session (sets the auth cookies) and redirect to `next`. Without this route
// those links 404.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only same-origin relative paths — never an attacker-controlled absolute
  // URL or protocol-relative `//host` (open-redirect guard).
  const raw = searchParams.get("next") ?? "/dashboard";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchangeCodeForSession:", error.message);
  }

  // No code, or the exchange failed (expired/used link) → back to login.
  return NextResponse.redirect(`${origin}/login?error=link_invalid`);
}
