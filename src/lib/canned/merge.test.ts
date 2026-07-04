import { describe, it, expect } from "vitest";
import { applyMergeFields } from "./merge";

const ctx = {
  contact: { name: "Ada", phone: "+15551234567", company: "Acme", email: "ada@acme.io" },
  agent: { name: "Sam" },
  account: { name: "Support HQ" },
};

describe("applyMergeFields", () => {
  it("substitutes every supported token", () => {
    expect(
      applyMergeFields(
        "Hi {{contact.name}} from {{contact.company}} — {{agent.name}} @ {{account.name}} ({{contact.phone}}, {{contact.email}})",
        ctx,
      ),
    ).toBe("Hi Ada from Acme — Sam @ Support HQ (+15551234567, ada@acme.io)");
  });

  it("tolerates inner whitespace", () => {
    expect(applyMergeFields("Hey {{ contact.name }}!", ctx)).toBe("Hey Ada!");
  });

  it("renders missing/empty fields as empty string", () => {
    expect(applyMergeFields("Hi {{contact.name}}!", { contact: {} })).toBe("Hi !");
    expect(applyMergeFields("Hi {{contact.name}}!", {})).toBe("Hi !");
  });

  it("leaves unknown tokens untouched", () => {
    expect(applyMergeFields("Order {{order.id}} ready", ctx)).toBe(
      "Order {{order.id}} ready",
    );
  });

  it("returns empty string for empty input", () => {
    expect(applyMergeFields("", ctx)).toBe("");
  });
});
