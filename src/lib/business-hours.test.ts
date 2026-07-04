import { describe, it, expect } from "vitest";
import {
  isWithinBusinessHours,
  coerceBusinessHours,
  DEFAULT_BUSINESS_HOURS,
} from "./business-hours";

// A fixed instant: Wed 2026-07-01 14:00 UTC.
const wed1400Utc = new Date("2026-07-01T14:00:00Z");
// Sat 2026-07-04 14:00 UTC.
const sat1400Utc = new Date("2026-07-04T14:00:00Z");

describe("isWithinBusinessHours", () => {
  it("open on a weekday inside the window (UTC)", () => {
    expect(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "UTC", wed1400Utc)).toBe(true);
  });

  it("closed on a disabled day (Saturday)", () => {
    expect(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "UTC", sat1400Utc)).toBe(false);
  });

  it("closed before open / at or after close", () => {
    const before = new Date("2026-07-01T08:59:00Z");
    const atClose = new Date("2026-07-01T17:00:00Z");
    expect(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "UTC", before)).toBe(false);
    expect(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "UTC", atClose)).toBe(false);
  });

  it("respects the timezone (14:00 UTC = 09:00 New York, still open)", () => {
    expect(
      isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "America/New_York", wed1400Utc),
    ).toBe(true);
    // 14:00 UTC = 06:00 New York → before 09:00 open → closed.
    const wed0600NyAsUtc = new Date("2026-07-01T10:00:00Z"); // 06:00 NY
    expect(
      isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "America/New_York", wed0600NyAsUtc),
    ).toBe(false);
  });

  it("falls back to open on an invalid timezone (never silences a business)", () => {
    expect(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, "Not/AZone", wed1400Utc)).toBe(true);
  });
});

describe("coerceBusinessHours", () => {
  it("fills missing days/fields from the default", () => {
    const out = coerceBusinessHours({ mon: { enabled: false } });
    expect(out.mon.enabled).toBe(false);
    expect(out.mon.open).toBe("09:00");
    expect(out.sun).toEqual(DEFAULT_BUSINESS_HOURS.sun);
  });

  it("handles null / garbage", () => {
    expect(coerceBusinessHours(null)).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(coerceBusinessHours({ mon: { open: "nope" } }).mon.open).toBe("09:00");
  });
});
