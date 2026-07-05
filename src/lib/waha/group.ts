// ============================================================
// Resolve a WhatsApp group's subject (name) via WAHA and store it on the
// group's contact row. A group is ingested with a placeholder name on first
// sight; this fills in the real subject, best-effort, after the response.
//
// Endpoint (parsed defensively — GOWS shapes vary):
//   GET /api/{session}/groups/{groupId}  → { subject | name, ... }
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { wahaRequest } from "./client";
import type { WahaCreds } from "./config";

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
      return null;
    }
  } catch {
    return null;
  }
}

export async function fetchGroupSubject(
  creds: WahaCreds,
  groupJid: string,
): Promise<string | null> {
  const path = `/api/${encodeURIComponent(creds.session)}/groups/${encodeURIComponent(groupJid)}`;
  const info = await getJson(creds, path);
  // Some builds nest the subject under `groupMetadata`.
  return (
    pick(info, ["subject", "name"]) ??
    pick((info as Record<string, unknown> | null)?.groupMetadata, ["subject", "name"])
  );
}

/**
 * Fill in a group's real subject on its contact row, best-effort. Never throws
 * — a failed enrich must not affect message flow.
 */
export async function enrichGroupFromWaha(
  admin: SupabaseClient,
  creds: WahaCreds,
  contactId: string,
  groupJid: string,
): Promise<void> {
  try {
    const subject = await fetchGroupSubject(creds, groupJid);
    if (subject) {
      await admin
        .from("contacts")
        .update({ name: subject, updated_at: new Date().toISOString() })
        .eq("id", contactId);
    }
  } catch (err) {
    console.warn("[waha group] enrich failed:", err);
  }
}
