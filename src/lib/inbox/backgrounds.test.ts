import { describe, it, expect } from "vitest";
import {
  parseBackground,
  isValidBackground,
  resolveBackgroundToken,
  backgroundStyle,
  backgroundImageUrl,
  DEFAULT_BACKGROUND,
  DOODLE_BG_CLASSES,
} from "./backgrounds";

describe("parseBackground", () => {
  it("treats null / empty / whitespace as inherit", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(parseBackground(v)).toEqual({ kind: "inherit" });
    }
  });

  it("recognises known presets", () => {
    expect(parseBackground("doodle")).toEqual({ kind: "preset", key: "doodle" });
    expect(parseBackground("emerald")).toEqual({ kind: "preset", key: "emerald" });
  });

  it("rejects unknown presets as inherit", () => {
    expect(parseBackground("neon-explosion")).toEqual({ kind: "inherit" });
  });

  it("parses + lower-cases custom colours", () => {
    expect(parseBackground("color:#AABBCC")).toEqual({ kind: "color", hex: "#aabbcc" });
  });

  it("rejects malformed colours", () => {
    for (const v of ["color:red", "color:#fff", "color:#gggggg", "color:112233"]) {
      expect(parseBackground(v).kind).toBe("inherit");
    }
  });

  it("parses valid image paths but rejects traversal / nesting", () => {
    expect(parseBackground("image:account-abc123/1700-hero.jpg")).toEqual({
      kind: "image",
      path: "account-abc123/1700-hero.jpg",
    });
    for (const bad of [
      "image:account-abc/../../etc/passwd",
      "image:account-abc/sub/dir/x.png",
      "image:not-an-account/x.png",
      "image:account-abc/has space.png",
      'image:account-abc/x").png',
    ]) {
      expect(parseBackground(bad).kind).toBe("inherit");
    }
  });
});

describe("isValidBackground", () => {
  it("accepts inherit (null/empty) and every valid token form", () => {
    for (const v of [null, "", "doodle", "plain", "color:#123abc", "image:account-x/y.png"]) {
      expect(isValidBackground(v)).toBe(true);
    }
  });
  it("rejects junk", () => {
    for (const v of ["haxx", "color:orange", "image:/etc", "url(evil)"]) {
      expect(isValidBackground(v)).toBe(false);
    }
  });
});

describe("resolveBackgroundToken", () => {
  it("prefers the conversation override", () => {
    expect(resolveBackgroundToken("emerald", "ocean")).toBe("emerald");
  });
  it("falls back to the account default", () => {
    expect(resolveBackgroundToken(null, "ocean")).toBe("ocean");
    expect(resolveBackgroundToken("", "ocean")).toBe("ocean");
  });
  it("falls back to the built-in doodle when nothing valid is set", () => {
    expect(resolveBackgroundToken(null, null)).toBe(DEFAULT_BACKGROUND);
    expect(resolveBackgroundToken("garbage", "also-garbage")).toBe(DEFAULT_BACKGROUND);
  });
});

describe("backgroundStyle", () => {
  it("maps the doodle preset to its classes", () => {
    expect(backgroundStyle("doodle").className).toBe(DOODLE_BG_CLASSES);
  });
  it("maps a colour token to an inline backgroundColor", () => {
    expect(backgroundStyle("color:#abcdef").style.backgroundColor).toBe("#abcdef");
  });
  it("maps an image token to a cover backgroundImage url()", () => {
    const s = backgroundStyle("image:account-x/pic.webp").style;
    expect(String(s.backgroundImage)).toContain("pic.webp");
    expect(s.backgroundSize).toBe("cover");
  });
  it("falls back to the doodle for inherit / junk", () => {
    expect(backgroundStyle("").className).toBe(DOODLE_BG_CLASSES);
    expect(backgroundStyle("nope").className).toBe(DOODLE_BG_CLASSES);
  });
});

describe("backgroundImageUrl", () => {
  it("builds a public bucket URL for the path", () => {
    const url = backgroundImageUrl("account-x/pic.png");
    expect(url).toContain("/storage/v1/object/public/chat-backgrounds/account-x/pic.png");
  });
});
