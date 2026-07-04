/**
 * Business hours — a per-weekday open/close schedule evaluated in the
 * account's timezone. Pure + dependency-free so it's trivially testable
 * and safe to run in the webhook (server) or the settings UI (client).
 */

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface DayHours {
  enabled: boolean;
  /** "HH:mm", 24-hour. */
  open: string;
  /** "HH:mm", 24-hour. Must be after `open` (no overnight spans in v1). */
  close: string;
}

export type BusinessHours = Record<DayKey, DayHours>;

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { enabled: true, open: "09:00", close: "17:00" },
  tue: { enabled: true, open: "09:00", close: "17:00" },
  wed: { enabled: true, open: "09:00", close: "17:00" },
  thu: { enabled: true, open: "09:00", close: "17:00" },
  fri: { enabled: true, open: "09:00", close: "17:00" },
  sat: { enabled: false, open: "09:00", close: "17:00" },
  sun: { enabled: false, open: "09:00", close: "17:00" },
};

// Intl weekday short names → our keys.
const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

/** Minutes-since-midnight for an "HH:mm" string; NaN-safe → -1. */
function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Is `now` within the schedule, evaluated in `timezone`? A day that's
 * disabled, or a time outside [open, close), is "closed". Falls back to
 * "open" (never blocks) if the timezone is invalid, so a misconfiguration
 * can't accidentally silence a real business.
 */
export function isWithinBusinessHours(
  hours: BusinessHours,
  timezone: string,
  now: Date,
): boolean {
  let weekday: string;
  let hh: number;
  let mm: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    hh = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
    mm = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  } catch {
    return true; // invalid timezone → don't gate anything
  }

  const key = WEEKDAY_TO_KEY[weekday];
  const day = key ? hours[key] : undefined;
  if (!day || !day.enabled) return false;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return true;

  const cur = hh * 60 + mm;
  const openMin = toMinutes(day.open);
  const closeMin = toMinutes(day.close);
  if (openMin < 0 || closeMin < 0 || closeMin <= openMin) return false;
  return cur >= openMin && cur < closeMin;
}

/** Narrow an unknown JSON value to a BusinessHours, filling gaps from the
 *  default. Used when reading the `accounts.business_hours` JSONB. */
export function coerceBusinessHours(value: unknown): BusinessHours {
  const src = (value ?? {}) as Record<string, Partial<DayHours>>;
  const out = {} as BusinessHours;
  for (const key of Object.keys(DEFAULT_BUSINESS_HOURS) as DayKey[]) {
    const d = src[key] ?? {};
    const def = DEFAULT_BUSINESS_HOURS[key];
    out[key] = {
      enabled: typeof d.enabled === "boolean" ? d.enabled : def.enabled,
      open: typeof d.open === "string" && toMinutes(d.open) >= 0 ? d.open : def.open,
      close: typeof d.close === "string" && toMinutes(d.close) >= 0 ? d.close : def.close,
    };
  }
  return out;
}
