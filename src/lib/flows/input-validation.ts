/**
 * Validation for `collect_input` node answers.
 *
 * A collect_input node can require the customer's reply to look like an
 * email / phone number / custom pattern before the run advances. This
 * is the single source of truth for that check — the runner
 * (`engine.ts`) enforces it on inbound replies, and the builder /
 * save-time validator (`validate.ts`) uses `isValidRegex` to reject a
 * regex node that can't compile.
 *
 * Kept pure (no DB, no Meta) so it's trivially unit-testable and can be
 * reused client-side if we ever add a live "test this validator" widget.
 */

export type CollectInputValidation = "any" | "email" | "phone" | "regex";

// Deliberately permissive, ReDoS-safe email shape: one @, a dot in the
// domain, no whitespace. We're gating a WhatsApp reply, not doing RFC
// 5322 — the goal is "did they type something email-shaped", and the
// downstream system that consumes the address does the authoritative
// check. No nested quantifiers, so it can't blow up on adversarial input.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Plausible phone number: 7–15 digits (E.164 tops out at 15), allowing
 * the usual human separators and an optional leading `+`. We don't
 * verify the number is reachable — just that it's phone-shaped.
 */
export function isPlausiblePhone(value: string): boolean {
  const trimmed = value.trim();
  // Only +, digits, spaces, dashes, dots, parens are allowed characters.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** True iff `pattern` compiles as a JS RegExp. */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does `value` satisfy the node's validation rule?
 *
 * Rules:
 *   - Empty (after trim) is ALWAYS invalid — collect_input requires an
 *     actual answer regardless of type.
 *   - `any` / undefined → any non-empty text passes (backward compatible
 *     with flows authored before validation existed).
 *   - `email` / `phone` → shape checks above.
 *   - `regex` → tests against the author's pattern. A missing or
 *     non-compiling pattern is treated as "accept" rather than trapping
 *     the customer in an un-satisfiable reprompt loop — save-time
 *     validation (`validate.ts`) already blocks activating such a node,
 *     so this only guards drafts / direct-API edge cases.
 */
export function validateCollectedInput(
  value: string,
  validation: CollectInputValidation | undefined,
  regex: string | undefined,
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  switch (validation ?? "any") {
    case "any":
      return true;
    case "email":
      return EMAIL_RE.test(trimmed);
    case "phone":
      return isPlausiblePhone(trimmed);
    case "regex": {
      if (!regex || !isValidRegex(regex)) return true;
      // The pattern is author-controlled and the value is a bounded
      // WhatsApp reply, so this is safe to run inline.
      return new RegExp(regex).test(trimmed);
    }
    default:
      // Unknown validation value (e.g. a future type reaching an older
      // runner) — accept rather than strand the customer.
      return true;
  }
}
