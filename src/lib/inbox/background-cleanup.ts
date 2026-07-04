import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAT_BG_BUCKET, parseBackground } from "./backgrounds";

// ============================================================
// Wallpaper garbage collection
//
// When a chat-background is changed away from an uploaded image (replaced
// with a different image / preset / colour, or cleared), the old object
// would otherwise linger forever in the `chat-backgrounds` bucket. This
// deletes it — but only once we've confirmed no other row still points at
// it, so we never break a background that's still in use.
//
// Reference check covers both scopes an image token can live in:
//   - accounts.inbox_background (the team default)
//   - conversations.background  (any per-chat override)
//
// Best-effort: a failed delete or reference read is logged and swallowed.
// An orphaned object is a storage nit, never worth failing the user's save.
// ============================================================

/**
 * Delete the previous background's uploaded image if it's now orphaned.
 *
 * Call AFTER the new value has been written, so the reference check sees
 * the post-update state (the row being changed no longer points at the old
 * token). No-op unless `oldToken` is a distinct `image:` token.
 */
export async function deleteOrphanedBackgroundImage(
  db: SupabaseClient,
  accountId: string,
  oldToken: string | null | undefined,
  newToken: string | null | undefined,
): Promise<void> {
  const old = parseBackground(oldToken);
  if (old.kind !== "image") return;
  // Unchanged — the same image is still the current value.
  if ((oldToken ?? "") === (newToken ?? "")) return;

  const token = `image:${old.path}`;

  try {
    // Still the account default?
    const { data: acct } = await db
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("inbox_background", token)
      .maybeSingle();
    if (acct) return;

    // Still referenced by any conversation in this account?
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("account_id", accountId)
      .eq("background", token)
      .limit(1)
      .maybeSingle();
    if (conv) return;

    const { error } = await db.storage.from(CHAT_BG_BUCKET).remove([old.path]);
    if (error) {
      console.warn("[background-cleanup] remove failed:", error.message);
    }
  } catch (err) {
    console.warn("[background-cleanup] skipped:", err);
  }
}
