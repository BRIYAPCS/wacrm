// ============================================================
// Fetch a WhatsApp contact's profile (photo + about) via WAHA and enrich the
// stored contact. Like wsapi, WAHA links a real WhatsApp session so it can
// supply a picture/about; Meta/Twilio give only the display name.
//
// Endpoints (parsed defensively + logged — GOWS may not expose all of them):
//   GET /api/contacts/profile-picture?contactId={chatId}&session={s}
//   GET /api/contacts/about?contactId={chatId}&session={s}
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { wahaRequest } from "./client";
import { phoneToChatId, type WahaCreds } from "./config";

export interface WahaProfile {
  avatarUrl: string | null;
  about: string | null;
}

/** Re-fetch a profile at most this often per contact. */
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

function pick(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function getJson(creds: WahaCreds, path: string): Promise<unknown | null> {
  try {
    const res = await wahaRequest(creds, "GET", path);
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text.trim() ? { value: text.trim() } : null;
    }
  } catch {
    return null;
  }
}

export async function fetchWahaProfile(
  creds: WahaCreds,
  chatId: string,
): Promise<WahaProfile> {
  const q = `contactId=${encodeURIComponent(chatId)}&session=${encodeURIComponent(creds.session)}`;

  const pic = await getJson(creds, `/api/contacts/profile-picture?${q}`);
  if (pic) console.log("[waha profile] /profile-picture:", JSON.stringify(pic).slice(0, 200));
  const avatarUrl = pick(pic, ["profilePictureURL", "profilePictureUrl", "url", "value"]);

  const aboutRes = await getJson(creds, `/api/contacts/about?${q}`);
  if (aboutRes) console.log("[waha profile] /about:", JSON.stringify(aboutRes).slice(0, 200));
  const about = pick(aboutRes, ["about", "status", "value"]);

  return { avatarUrl, about };
}

/**
 * Enrich a stored contact with its WhatsApp photo/about, best-effort.
 * Staleness-guarded (24h TTL unless `force`). Never throws — a failed enrich
 * must not affect message flow.
 */
export async function enrichContactFromWaha(
  admin: SupabaseClient,
  creds: WahaCreds,
  contactId: string,
  phone: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    if (!opts.force) {
      const { data } = await admin
        .from("contacts")
        .select("avatar_url, profile_fetched_at")
        .eq("id", contactId)
        .maybeSingle();
      const fetchedAt = data?.profile_fetched_at ? Date.parse(data.profile_fetched_at) : 0;
      if (data?.avatar_url && Date.now() - fetchedAt < PROFILE_TTL_MS) return;
    }

    const profile = await fetchWahaProfile(creds, phoneToChatId(phone));

    const update: Record<string, unknown> = {
      profile_fetched_at: new Date().toISOString(),
    };
    if (profile.avatarUrl) update.avatar_url = profile.avatarUrl;
    if (profile.about) update.about = profile.about;

    await admin.from("contacts").update(update).eq("id", contactId);
  } catch (err) {
    console.warn("[waha profile] enrich failed:", err);
  }
}
