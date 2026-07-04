import { describe, it, expect } from "vitest";
import { listFlowTemplates, getFlowTemplate } from "./templates";
import { validateFlowForActivation } from "./validate";

const templates = listFlowTemplates();

describe("flow templates", () => {
  it("ships a substantial gallery", () => {
    expect(templates.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique slugs, and getFlowTemplate resolves each", () => {
    const slugs = templates.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(getFlowTemplate(slug)?.slug).toBe(slug);
    }
  });

  it("every template's entry_node_id points at a real node", () => {
    for (const t of templates) {
      expect(t.nodes.some((n) => n.node_key === t.entry_node_id)).toBe(true);
    }
  });

  // The important one: a template a user clones must activate without
  // fixing anything, so it can't carry any error-severity issue.
  it.each(templates.map((t) => [t.slug, t] as const))(
    "%s activates with zero validation errors",
    (_slug, template) => {
      const issues = validateFlowForActivation(
        {
          name: template.name,
          trigger_type: template.trigger_type,
          trigger_config: template.trigger_config as Record<string, unknown>,
          entry_node_id: template.entry_node_id,
        },
        template.nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config as Record<string, unknown>,
        })),
      );
      const errors = issues.filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
    },
  );
});
