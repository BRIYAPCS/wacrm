// ============================================================
// Fetch a WhatsApp contact's profile (photo + about) via wsapi.chat and
// enrich the stored contact. Only wsapi.chat can supply these (it links a
// real WhatsApp session); Meta/Twilio give only the display name.
//
// Endpoints (per the WSAPI docs; shapes parsed defensively + logged, since
// they aren't fully documented):
//   GET /users/{jid}                 → profile info (picture, status, name)
//   GET /chats/{jid}/profile-picture → the profile picture (URL)
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { wsapiRequest } from "./client";
import { phoneToJid, type WsapiCreds } from "./config";

export interface WsapiProfile {
  avatarUrl: string | null;
  about: string | null;
  name: string | null;
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

async function getJson(creds: WsapiCreds, path: string): Promise<unknown | null> {
  try {
    const res = await wsapiRequest(creds, "GET", path);
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text.trim() ? { url: text.trim() } : null;
    }
  } catch {
    return null;
  }
}

export async function fetchWsapiProfile(
  creds: WsapiCreds,
  jid: string,
): Promise<WsapiProfile> {
  const ejid = encodeURIComponent(jid);

  const user = await getJson(creds, `/users/${ejid}`);
  if (user) console.log("[wsapi profile] /users:", JSON.stringify(user).slice(0, 300));

  let avatarUrl =
    pick(user, ["profilePictureUrl", "pictureUrl", "picture", "imgUrl", "avatar", "url"]) ??
    // Some shapes nest it.
    pick((user as { profilePicture?: unknown })?.profilePicture, ["url"]);
  const about = pick(user, ["status", "about", "statusText"]);
  const name = pick(user, ["pushName", "name", "notify", "fullName"]);

  // Fall back to the dedicated picture endpoint if we didn't get one.
  if (!avatarUrl) {
    const pic = await getJson(creds, `/chats/${ejid}/profile-picture`);
    if (pic) console.log("[wsapi profile] /profile-picture:", JSON.stringify(pic).slice(0, 200));
    avatarUrl = pick(pic, ["url", "pictureUrl", "profilePictureUrl", "image"]);
  }

  return { avatarUrl: avatarUrl ?? null, about, name };
}

/**
 * Enrich a stored contact with its WhatsApp photo/about, best-effort.
 * Staleness-guarded: skips if we fetched a picture within the TTL (unless
 * `force`). Never throws — a failed enrich must not affect message flow.
 */
export async function enrichContactFromWsapi(
  admin: SupabaseClient,
  creds: WsapiCreds,
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

    const profile = await fetchWsapiProfile(creds, phoneToJid(phone));

    const update: Record<string, unknown> = {
      profile_fetched_at: new Date().toISOString(),
    };
    if (profile.avatarUrl) update.avatar_url = profile.avatarUrl;
    if (profile.about) update.about = profile.about;

    await admin.from("contacts").update(update).eq("id", contactId);
  } catch (err) {
    console.warn("[wsapi profile] enrich failed:", err);
  }
}
