import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyCronSecret } from "./auth";

const SECRET = "s3cr3t-cron-value";
const req = (headers: Record<string, string>) =>
  new Request("https://app.test/api/automations/cron", { headers });

describe("verifyCronSecret", () => {
  const original = process.env.AUTOMATION_CRON_SECRET;
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTOMATION_CRON_SECRET;
    else process.env.AUTOMATION_CRON_SECRET = original;
  });

  it("returns 503 when the server secret is not configured", () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    expect(verifyCronSecret(req({}))?.status).toBe(503);
  });

  it("returns 401 on missing or wrong secret", () => {
    expect(verifyCronSecret(req({}))?.status).toBe(401);
    expect(verifyCronSecret(req({ "x-cron-secret": "nope" }))?.status).toBe(401);
    expect(verifyCronSecret(req({ authorization: "Bearer nope" }))?.status).toBe(
      401,
    );
  });

  it("authorizes via x-cron-secret", () => {
    expect(verifyCronSecret(req({ "x-cron-secret": SECRET }))).toBeNull();
  });

  it("authorizes via Authorization: Bearer (Vercel Cron)", () => {
    expect(verifyCronSecret(req({ authorization: `Bearer ${SECRET}` }))).toBeNull();
  });

  it("is case-insensitive on the Bearer prefix", () => {
    expect(verifyCronSecret(req({ authorization: `bearer ${SECRET}` }))).toBeNull();
  });
});
