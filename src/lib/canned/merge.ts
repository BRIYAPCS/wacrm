/**
 * Merge-field substitution for canned responses (saved replies).
 *
 * A saved reply's stored body may contain `{{contact.name}}` style
 * tokens. They're resolved on the client the moment the agent inserts
 * the reply into the composer — the agent then sees (and can edit) the
 * final text before sending, so a missing field is never a surprise.
 *
 * Supported tokens (unknown / empty → empty string, same convention as
 * the flows engine's interpolation):
 *   {{contact.name}} {{contact.phone}} {{contact.company}} {{contact.email}}
 *   {{agent.name}}   {{account.name}}
 */

export interface MergeContext {
  contact?: {
    name?: string | null;
    phone?: string | null;
    company?: string | null;
    email?: string | null;
  } | null;
  agent?: { name?: string | null } | null;
  account?: { name?: string | null } | null;
}

/** The tokens the UI advertises, for a "insert field" helper / docs. */
export const MERGE_FIELDS = [
  "contact.name",
  "contact.phone",
  "contact.company",
  "contact.email",
  "agent.name",
  "account.name",
] as const;

export function applyMergeFields(template: string, ctx: MergeContext): string {
  if (!template) return "";
  const values: Record<string, string> = {
    "contact.name": ctx.contact?.name ?? "",
    "contact.phone": ctx.contact?.phone ?? "",
    "contact.company": ctx.contact?.company ?? "",
    "contact.email": ctx.contact?.email ?? "",
    "agent.name": ctx.agent?.name ?? "",
    "account.name": ctx.account?.name ?? "",
  };
  // Tolerate optional inner whitespace: {{ contact.name }}.
  return template.replace(
    /\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}/g,
    (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
