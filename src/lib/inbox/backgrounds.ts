import type { CSSProperties } from "react";

// ============================================================
// Chat backgrounds (WhatsApp-style wallpapers)
//
// A background is stored as a small, validated TOKEN string (never raw
// CSS) at two scopes — accounts.inbox_background (team default) and
// conversations.background (per-chat override). This module is the single
// source of truth for:
//   - the token grammar + validation (used on every write path)
//   - the curated preset library
//   - turning a token into safe CSS (className + inline style)
//   - resolving the *effective* token (conversation → account → doodle)
//
// Token grammar:
//   ''/null                → inherit (see resolveBackgroundToken)
//   'doodle'               → the built-in WhatsApp-style doodle (default)
//   'plain'                → the flat theme background, no pattern
//   <preset key>           → one of PRESETS (solid colours / gradients)
//   'color:#rrggbb'        → a custom solid colour
//   'image:<path>'         → an uploaded wallpaper in the CHAT_BG_BUCKET,
//                            where <path> is the account-scoped object
//                            path (account-<id>/<file>)
// ============================================================

/** Storage bucket that holds uploaded wallpapers (migration 048). */
export const CHAT_BG_BUCKET = "chat-backgrounds";

/** 5 MB — matches the bucket's `file_size_limit` (migration 048). */
export const CHAT_BG_MAX_BYTES = 5 * 1024 * 1024;

/** Image MIME types the bucket accepts (migration 048). */
export const CHAT_BG_ACCEPT = "image/png,image/jpeg,image/webp";

/** The built-in default when nothing is set anywhere. */
export const DEFAULT_BACKGROUND = "doodle";

/**
 * WhatsApp-style doodle background classes. Kept here (rather than inline
 * in message-thread) so the picker preview and the thread render from one
 * definition — swap the asset once and both update.
 */
export const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export interface BackgroundPreset {
  /** Stored token value. */
  key: string;
  /** Human label in the picker. */
  label: string;
  /** CSS applied to the chat area for this preset. */
  render: { className?: string; style?: CSSProperties };
  /** Small style used for the picker swatch (defaults to `render.style`). */
  swatch?: CSSProperties;
}

/**
 * Curated preset library. `doodle` and `plain` come first (the two
 * "pattern vs flat" defaults), followed by solid colours and a couple of
 * subtle gradients that read well behind message bubbles in dark mode.
 */
export const PRESETS: BackgroundPreset[] = [
  {
    key: "doodle",
    label: "Doodle",
    render: { className: DOODLE_BG_CLASSES },
    swatch: { backgroundColor: "#0b141a" },
  },
  {
    key: "plain",
    label: "Plain",
    render: { className: "bg-background" },
    swatch: { backgroundColor: "var(--background, #0b141a)" },
  },
  { key: "graphite", label: "Graphite", render: { style: { backgroundColor: "#1f2428" } } },
  { key: "midnight", label: "Midnight", render: { style: { backgroundColor: "#0b141a" } } },
  { key: "emerald", label: "Emerald", render: { style: { backgroundColor: "#0b3d2e" } } },
  { key: "ocean", label: "Ocean", render: { style: { backgroundColor: "#0b2a3d" } } },
  { key: "plum", label: "Plum", render: { style: { backgroundColor: "#2a1b3d" } } },
  { key: "rose", label: "Rose", render: { style: { backgroundColor: "#3d1b2a" } } },
  { key: "sand", label: "Sand", render: { style: { backgroundColor: "#3a2f1e" } } },
  {
    key: "dusk",
    label: "Dusk",
    render: { style: { backgroundImage: "linear-gradient(160deg, #1e293b 0%, #0f172a 100%)" } },
  },
  {
    key: "forest",
    label: "Forest",
    render: { style: { backgroundImage: "linear-gradient(160deg, #14332a 0%, #0b1f19 100%)" } },
  },
  {
    key: "aurora",
    label: "Aurora",
    render: { style: { backgroundImage: "linear-gradient(160deg, #14293d 0%, #241436 100%)" } },
  },
];

const PRESET_BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));

/** `#rrggbb` (six hex digits). Case-insensitive; normalised to lower-case. */
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Uploaded-wallpaper object path: one account segment + one filename, no
 * traversal, no nested folders, no whitespace. Kept deliberately strict so
 * the value is safe to drop into a CSS `url()` and can't point outside the
 * account's own folder. Matches paths produced by `buildMediaPath`.
 */
const IMAGE_PATH_RE = /^account-[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/;

export type ParsedBackground =
  | { kind: "inherit" }
  | { kind: "preset"; key: string }
  | { kind: "color"; hex: string }
  | { kind: "image"; path: string };

/**
 * Parse a raw stored value into a discriminated token. Unknown / malformed
 * values fall back to `inherit` so a bad row can never break rendering or
 * smuggle CSS through — the caller then resolves inherit → the default.
 */
export function parseBackground(value: string | null | undefined): ParsedBackground {
  const v = (value ?? "").trim();
  if (!v) return { kind: "inherit" };

  if (v.startsWith("color:")) {
    const hex = v.slice("color:".length).toLowerCase();
    return HEX_RE.test(hex) ? { kind: "color", hex } : { kind: "inherit" };
  }

  if (v.startsWith("image:")) {
    const path = v.slice("image:".length);
    return IMAGE_PATH_RE.test(path) ? { kind: "image", path } : { kind: "inherit" };
  }

  return PRESET_BY_KEY.has(v) ? { kind: "preset", key: v } : { kind: "inherit" };
}

/**
 * Whether a value is a valid, storable background token. `null` / `''` are
 * valid (they mean "inherit" / "clear"). Used by the write paths (API
 * route + client) to reject anything that wouldn't render.
 */
export function isValidBackground(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  return parseBackground(v).kind !== "inherit";
}

/**
 * Resolve the *effective* concrete token for a conversation: its own
 * override, else the account default, else the built-in doodle. Never
 * returns inherit — the result always renders to something.
 */
export function resolveBackgroundToken(
  conversationBg: string | null | undefined,
  accountBg: string | null | undefined,
): string {
  for (const candidate of [conversationBg, accountBg]) {
    if (candidate && parseBackground(candidate).kind !== "inherit") return candidate;
  }
  return DEFAULT_BACKGROUND;
}

/**
 * Build the public URL for an uploaded wallpaper from its object path. The
 * bucket is public, so the URL is deterministic — no client needed.
 * `encodeURI` keeps it safe inside `url("…")` even though the path grammar
 * already forbids quotes/parens/spaces.
 */
export function backgroundImageUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${CHAT_BG_BUCKET}/${encodeURI(path)}`;
}

/**
 * Turn a token into the CSS to apply to the chat area. Pass an already-
 * resolved token (see {@link resolveBackgroundToken}); `inherit` / unknown
 * falls back to the doodle so there's always a backdrop.
 *
 * Uploaded images and gradients get `cover` sizing; presets/colours are
 * flat fills. The returned `style` is plain, app-generated CSS — never
 * user-authored strings — so it's safe to spread onto a div.
 */
export function backgroundStyle(token: string): {
  className: string;
  style: CSSProperties;
} {
  const parsed = parseBackground(token);

  switch (parsed.kind) {
    case "preset": {
      const preset = PRESET_BY_KEY.get(parsed.key)!;
      return { className: preset.render.className ?? "", style: preset.render.style ?? {} };
    }
    case "color":
      return { className: "", style: { backgroundColor: parsed.hex } };
    case "image":
      return {
        className: "",
        style: {
          backgroundImage: `url("${backgroundImageUrl(parsed.path)}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        },
      };
    case "inherit":
    default:
      return { className: DOODLE_BG_CLASSES, style: {} };
  }
}

/** Small preview style for a token, used by picker swatches. */
export function backgroundSwatchStyle(token: string): CSSProperties {
  const parsed = parseBackground(token);
  if (parsed.kind === "preset") {
    const preset = PRESET_BY_KEY.get(parsed.key)!;
    return preset.swatch ?? preset.render.style ?? {};
  }
  if (parsed.kind === "color") return { backgroundColor: parsed.hex };
  if (parsed.kind === "image")
    return {
      backgroundImage: `url("${backgroundImageUrl(parsed.path)}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  return { backgroundColor: "#0b141a" };
}
