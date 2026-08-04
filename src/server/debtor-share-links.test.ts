import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  DEBTOR_SHARE_LINK_TTL_MS,
  createDebtorShareLink,
  generateDebtorShareToken,
  getDebtorShareLinkStatus,
  hashDebtorShareToken,
  isCanonicalDebtorShareToken,
  revokeDebtorShareLink,
} = await import("./debtor-share-links");

const friend = { id: "11111111-1111-4111-8111-111111111111" };

function transactionDatabase({ active = [], inserted = [], revoked = [] }: { active?: unknown[]; inserted?: unknown[]; revoked?: unknown[] } = {}) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ for: vi.fn().mockResolvedValue(active) })),
        orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(active) })),
      })),
    })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(revoked) })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(inserted) })),
  }));
  const tx = { select, update, insert };
  return {
    transaction: vi.fn(async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)),
    select,
    update,
    insert,
  } as never;
}

describe("debtor share token primitives", () => {
  it("generates canonical lowercase UUIDv4 tokens and hashes only canonical values", () => {
    const token = generateDebtorShareToken();
    expect(isCanonicalDebtorShareToken(token)).toBe(true);
    expect(token).toBe(token.toLowerCase());
    expect(hashDebtorShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(isCanonicalDebtorShareToken(token.toUpperCase())).toBe(false);
    expect(isCanonicalDebtorShareToken("11111111-1111-4111-7111-111111111111")).toBe(false);
    expect(() => hashDebtorShareToken(token.toUpperCase())).toThrow();
  });
});

describe("debtor share link lifecycle", () => {
  const now = new Date("2026-08-04T00:00:00.000Z");

  it("creates, replaces, and stores only a digest with an exact seven-day expiry", async () => {
    const database = transactionDatabase({ active: [friend], inserted: [{ expiresAt: new Date(now.getTime() + DEBTOR_SHARE_LINK_TTL_MS) }] });
    const first = await createDebtorShareLink(database, "owner-a", friend.id, now);
    const second = await createDebtorShareLink(database, "owner-a", friend.id, new Date(now.getTime() + 1_000));
    expect(first.token).not.toBe(second.token);
    expect(first.expiresAt.getTime() - now.getTime()).toBe(DEBTOR_SHARE_LINK_TTL_MS);
    expect((database as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledTimes(2);
    const insertMock = (database as unknown as { insert: ReturnType<typeof vi.fn> }).insert;
    const insertedValues = (insertMock.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> }).values.mock.calls[0]?.[0] as { tokenHash: string };
    expect(insertedValues.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(insertedValues.tokenHash).not.toBe(first.token);
  });

  it("treats a foreign friend as missing and revokes idempotently", async () => {
    const missingDatabase = transactionDatabase();
    await expect(createDebtorShareLink(missingDatabase, "owner-a", friend.id, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(revokeDebtorShareLink(missingDatabase, "owner-a", friend.id, now)).resolves.toBe(false);

    const database = transactionDatabase({ active: [friend], revoked: [{ id: "link-a" }] });
    await expect(revokeDebtorShareLink(database, "owner-a", friend.id, now)).resolves.toBe(true);
    expect((database as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledOnce();
  });

  it("reports no link, active, expired, and revoked without returning a hash", async () => {
    const database = transactionDatabase({ active: [] });
    await expect(getDebtorShareLinkStatus(database, "owner-a", friend.id, now)).resolves.toEqual({ status: "none", expiresAt: null });

    const activeDatabase = transactionDatabase({ active: [{ expiresAt: new Date(now.getTime() + 1_000), revokedAt: null }] });
    await expect(getDebtorShareLinkStatus(activeDatabase, "owner-a", friend.id, now)).resolves.toMatchObject({ status: "active" });
    const expiredDatabase = transactionDatabase({ active: [{ expiresAt: now, revokedAt: null }] });
    await expect(getDebtorShareLinkStatus(expiredDatabase, "owner-a", friend.id, now)).resolves.toMatchObject({ status: "expired" });
    const revokedDatabase = transactionDatabase({ active: [{ expiresAt: new Date(now.getTime() + 1_000), revokedAt: now }] });
    await expect(getDebtorShareLinkStatus(revokedDatabase, "owner-a", friend.id, now)).resolves.toMatchObject({ status: "revoked" });
    expect(JSON.stringify(await getDebtorShareLinkStatus(revokedDatabase, "owner-a", friend.id, now))).not.toContain("hash");
  });
});
