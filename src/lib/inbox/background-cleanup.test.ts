import { describe, it, expect, vi } from "vitest";
import { deleteOrphanedBackgroundImage } from "./background-cleanup";

/**
 * Minimal chainable Supabase stub. `accountRef` / `convRef` decide whether
 * the reference-check queries find a row still pointing at the old token;
 * `remove` records storage deletions.
 */
function makeDb(opts: { accountRef?: boolean; convRef?: boolean }) {
  const remove = vi.fn().mockResolvedValue({ error: null });
  const builder = (result: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: result, error: null });
    return chain;
  };
  const db = {
    from: (table: string) =>
      builder(
        table === "accounts"
          ? opts.accountRef
            ? { id: "a" }
            : null
          : opts.convRef
            ? { id: "c" }
            : null,
      ),
    storage: { from: () => ({ remove }) },
  };
  return { db: db as never, remove };
}

describe("deleteOrphanedBackgroundImage", () => {
  const IMG = "image:account-x/1700-hero.webp";

  it("deletes an orphaned image (nothing else references it)", async () => {
    const { db, remove } = makeDb({});
    await deleteOrphanedBackgroundImage(db, "x", IMG, "emerald");
    expect(remove).toHaveBeenCalledWith(["account-x/1700-hero.webp"]);
  });

  it("does nothing when the old value is not an image", async () => {
    const { db, remove } = makeDb({});
    await deleteOrphanedBackgroundImage(db, "x", "doodle", "emerald");
    expect(remove).not.toHaveBeenCalled();
  });

  it("does nothing when the image is unchanged", async () => {
    const { db, remove } = makeDb({});
    await deleteOrphanedBackgroundImage(db, "x", IMG, IMG);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps the image if the account default still references it", async () => {
    const { db, remove } = makeDb({ accountRef: true });
    await deleteOrphanedBackgroundImage(db, "x", IMG, null);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps the image if a conversation still references it", async () => {
    const { db, remove } = makeDb({ convRef: true });
    await deleteOrphanedBackgroundImage(db, "x", IMG, "color:#123456");
    expect(remove).not.toHaveBeenCalled();
  });

  it("handles a null new value (cleared background)", async () => {
    const { db, remove } = makeDb({});
    await deleteOrphanedBackgroundImage(db, "x", IMG, null);
    expect(remove).toHaveBeenCalledWith(["account-x/1700-hero.webp"]);
  });
});
