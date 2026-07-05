import { describe, it, expect } from "vitest";

import { splitE164, DEFAULT_COUNTRY_ISO2 } from "./countries";

describe("splitE164", () => {
  it("parses a US E.164 number to US + national digits", () => {
    const { country, national } = splitE164("+12025551234");
    expect(country.iso2).toBe("US");
    expect(national).toBe("2025551234");
  });

  it("uses the longest matching dial code (+52 over +5)", () => {
    const { country, national } = splitE164("+525512345678");
    expect(country.iso2).toBe("MX");
    expect(national).toBe("5512345678");
  });

  it("parses a 3-digit dial code (+44 UK)", () => {
    const { country, national } = splitE164("+442071234567");
    expect(country.iso2).toBe("GB");
    expect(national).toBe("2071234567");
  });

  it("does NOT mis-attribute a national-only number to a foreign country", () => {
    // Regression: "2025551234" (no '+') must not prefix-match Egypt (+20).
    // It stays under the default country and becomes correct E.164 on save.
    const { country, national } = splitE164("2025551234");
    expect(country.iso2).toBe(DEFAULT_COUNTRY_ISO2);
    expect(national).toBe("2025551234");
  });

  it("strips formatting from a national-only number", () => {
    const { country, national } = splitE164("(202) 555-1234");
    expect(country.iso2).toBe(DEFAULT_COUNTRY_ISO2);
    expect(national).toBe("2025551234");
  });

  it("returns the default country with empty national for blank/plus-only input", () => {
    expect(splitE164("").country.iso2).toBe(DEFAULT_COUNTRY_ISO2);
    expect(splitE164("").national).toBe("");
    expect(splitE164("+").national).toBe("");
  });

  it("honours the country code when the value is real E.164", () => {
    // With a leading '+', "20…" is legitimately Egypt.
    const { country, national } = splitE164("+201234567890");
    expect(country.iso2).toBe("EG");
    expect(national).toBe("1234567890");
  });
});
