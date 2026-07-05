// Country dial codes for the phone-number input. Not exhaustive, but covers
// the markets this CRM is realistically used in. `dialCode` is digits only
// (no '+'); `iso2` is the unique key. US/Canada are pinned first.

export interface Country {
  name: string;
  iso2: string;
  dialCode: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: "United States", iso2: "US", dialCode: "1", flag: "🇺🇸" },
  { name: "Canada", iso2: "CA", dialCode: "1", flag: "🇨🇦" },
  { name: "Mexico", iso2: "MX", dialCode: "52", flag: "🇲🇽" },
  { name: "United Kingdom", iso2: "GB", dialCode: "44", flag: "🇬🇧" },
  { name: "Argentina", iso2: "AR", dialCode: "54", flag: "🇦🇷" },
  { name: "Australia", iso2: "AU", dialCode: "61", flag: "🇦🇺" },
  { name: "Austria", iso2: "AT", dialCode: "43", flag: "🇦🇹" },
  { name: "Bangladesh", iso2: "BD", dialCode: "880", flag: "🇧🇩" },
  { name: "Belgium", iso2: "BE", dialCode: "32", flag: "🇧🇪" },
  { name: "Bolivia", iso2: "BO", dialCode: "591", flag: "🇧🇴" },
  { name: "Brazil", iso2: "BR", dialCode: "55", flag: "🇧🇷" },
  { name: "Chile", iso2: "CL", dialCode: "56", flag: "🇨🇱" },
  { name: "China", iso2: "CN", dialCode: "86", flag: "🇨🇳" },
  { name: "Colombia", iso2: "CO", dialCode: "57", flag: "🇨🇴" },
  { name: "Costa Rica", iso2: "CR", dialCode: "506", flag: "🇨🇷" },
  { name: "Denmark", iso2: "DK", dialCode: "45", flag: "🇩🇰" },
  { name: "Dominican Republic", iso2: "DO", dialCode: "1", flag: "🇩🇴" },
  { name: "Ecuador", iso2: "EC", dialCode: "593", flag: "🇪🇨" },
  { name: "Egypt", iso2: "EG", dialCode: "20", flag: "🇪🇬" },
  { name: "El Salvador", iso2: "SV", dialCode: "503", flag: "🇸🇻" },
  { name: "Finland", iso2: "FI", dialCode: "358", flag: "🇫🇮" },
  { name: "France", iso2: "FR", dialCode: "33", flag: "🇫🇷" },
  { name: "Germany", iso2: "DE", dialCode: "49", flag: "🇩🇪" },
  { name: "Ghana", iso2: "GH", dialCode: "233", flag: "🇬🇭" },
  { name: "Greece", iso2: "GR", dialCode: "30", flag: "🇬🇷" },
  { name: "Guatemala", iso2: "GT", dialCode: "502", flag: "🇬🇹" },
  { name: "Honduras", iso2: "HN", dialCode: "504", flag: "🇭🇳" },
  { name: "Hong Kong", iso2: "HK", dialCode: "852", flag: "🇭🇰" },
  { name: "India", iso2: "IN", dialCode: "91", flag: "🇮🇳" },
  { name: "Indonesia", iso2: "ID", dialCode: "62", flag: "🇮🇩" },
  { name: "Ireland", iso2: "IE", dialCode: "353", flag: "🇮🇪" },
  { name: "Israel", iso2: "IL", dialCode: "972", flag: "🇮🇱" },
  { name: "Italy", iso2: "IT", dialCode: "39", flag: "🇮🇹" },
  { name: "Japan", iso2: "JP", dialCode: "81", flag: "🇯🇵" },
  { name: "Kenya", iso2: "KE", dialCode: "254", flag: "🇰🇪" },
  { name: "Malaysia", iso2: "MY", dialCode: "60", flag: "🇲🇾" },
  { name: "Morocco", iso2: "MA", dialCode: "212", flag: "🇲🇦" },
  { name: "Netherlands", iso2: "NL", dialCode: "31", flag: "🇳🇱" },
  { name: "New Zealand", iso2: "NZ", dialCode: "64", flag: "🇳🇿" },
  { name: "Nicaragua", iso2: "NI", dialCode: "505", flag: "🇳🇮" },
  { name: "Nigeria", iso2: "NG", dialCode: "234", flag: "🇳🇬" },
  { name: "Norway", iso2: "NO", dialCode: "47", flag: "🇳🇴" },
  { name: "Pakistan", iso2: "PK", dialCode: "92", flag: "🇵🇰" },
  { name: "Panama", iso2: "PA", dialCode: "507", flag: "🇵🇦" },
  { name: "Paraguay", iso2: "PY", dialCode: "595", flag: "🇵🇾" },
  { name: "Peru", iso2: "PE", dialCode: "51", flag: "🇵🇪" },
  { name: "Philippines", iso2: "PH", dialCode: "63", flag: "🇵🇭" },
  { name: "Poland", iso2: "PL", dialCode: "48", flag: "🇵🇱" },
  { name: "Portugal", iso2: "PT", dialCode: "351", flag: "🇵🇹" },
  { name: "Puerto Rico", iso2: "PR", dialCode: "1", flag: "🇵🇷" },
  { name: "Russia", iso2: "RU", dialCode: "7", flag: "🇷🇺" },
  { name: "Saudi Arabia", iso2: "SA", dialCode: "966", flag: "🇸🇦" },
  { name: "Singapore", iso2: "SG", dialCode: "65", flag: "🇸🇬" },
  { name: "South Africa", iso2: "ZA", dialCode: "27", flag: "🇿🇦" },
  { name: "South Korea", iso2: "KR", dialCode: "82", flag: "🇰🇷" },
  { name: "Spain", iso2: "ES", dialCode: "34", flag: "🇪🇸" },
  { name: "Sweden", iso2: "SE", dialCode: "46", flag: "🇸🇪" },
  { name: "Switzerland", iso2: "CH", dialCode: "41", flag: "🇨🇭" },
  { name: "Thailand", iso2: "TH", dialCode: "66", flag: "🇹🇭" },
  { name: "Turkey", iso2: "TR", dialCode: "90", flag: "🇹🇷" },
  { name: "Ukraine", iso2: "UA", dialCode: "380", flag: "🇺🇦" },
  { name: "United Arab Emirates", iso2: "AE", dialCode: "971", flag: "🇦🇪" },
  { name: "Uruguay", iso2: "UY", dialCode: "598", flag: "🇺🇾" },
  { name: "Venezuela", iso2: "VE", dialCode: "58", flag: "🇻🇪" },
  { name: "Vietnam", iso2: "VN", dialCode: "84", flag: "🇻🇳" },
];

export const DEFAULT_COUNTRY_ISO2 = "US";

/**
 * Split an E.164 string ("+52155…") into a country + national digits, by the
 * longest matching dial code. Ties on dial code (e.g. +1) resolve to the first
 * listed (US). Returns the default country + the raw digits when nothing
 * matches (e.g. an empty or partial value).
 */
export function splitE164(value: string): { country: Country; national: string } {
  const raw = (value ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const fallback =
    COUNTRIES.find((c) => c.iso2 === DEFAULT_COUNTRY_ISO2) ?? COUNTRIES[0];
  if (!digits) return { country: fallback, national: "" };

  // Only treat leading digits as a country code when the value is real E.164
  // (starts with "+"). A stored national-only number like "2025551234" must
  // NOT be prefix-matched — "20…" would wrongly resolve to Egypt — so it stays
  // under the default country and becomes correct E.164 (+1…) on save.
  if (raw.startsWith("+")) {
    let best: Country | null = null;
    for (const c of COUNTRIES) {
      if (
        digits.startsWith(c.dialCode) &&
        (!best || c.dialCode.length > best.dialCode.length)
      ) {
        best = c;
      }
    }
    if (best) {
      return { country: best, national: digits.slice(best.dialCode.length) };
    }
  }
  return { country: fallback, national: digits };
}
