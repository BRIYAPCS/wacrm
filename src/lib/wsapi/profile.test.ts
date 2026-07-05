import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWsapiProfile } from "./profile";

const CREDS = { instanceId: "ins_x", apiKey: "sk_x" };
const realFetch = global.fetch;

function mockFetch(byPath: Record<string, unknown>) {
  global.fetch = vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(byPath)) {
      if (u.includes(frag)) {
        return new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status: body === null ? 404 : 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("fetchWsapiProfile", () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("parses picture + about + name from /users", async () => {
    mockFetch({
      "/users/": { profilePictureUrl: "https://cdn/pic.jpg", status: "Busy", pushName: "Ana" },
    });
    const p = await fetchWsapiProfile(CREDS, "1@s.whatsapp.net");
    expect(p.avatarUrl).toBe("https://cdn/pic.jpg");
    expect(p.about).toBe("Busy");
    expect(p.name).toBe("Ana");
  });

  it("handles alternate field names (picture/about/name)", async () => {
    mockFetch({ "/users/": { picture: "https://cdn/a.png", about: "Hi", name: "Bob" } });
    const p = await fetchWsapiProfile(CREDS, "1@s.whatsapp.net");
    expect(p.avatarUrl).toBe("https://cdn/a.png");
    expect(p.about).toBe("Hi");
    expect(p.name).toBe("Bob");
  });

  it("falls back to the profile-picture endpoint for the photo", async () => {
    mockFetch({
      "/users/": { status: "Away" }, // no picture here
      "/profile-picture": { url: "https://cdn/fallback.jpg" },
    });
    const p = await fetchWsapiProfile(CREDS, "1@s.whatsapp.net");
    expect(p.avatarUrl).toBe("https://cdn/fallback.jpg");
    expect(p.about).toBe("Away");
  });

  it("handles a raw-URL (non-JSON) picture response", async () => {
    mockFetch({
      "/users/": {},
      "/profile-picture": "https://cdn/raw.jpg",
    });
    const p = await fetchWsapiProfile(CREDS, "1@s.whatsapp.net");
    expect(p.avatarUrl).toBe("https://cdn/raw.jpg");
  });

  it("returns nulls when nothing is available", async () => {
    mockFetch({ "/users/": null, "/profile-picture": null });
    const p = await fetchWsapiProfile(CREDS, "1@s.whatsapp.net");
    expect(p).toEqual({ avatarUrl: null, about: null, name: null });
  });
});
