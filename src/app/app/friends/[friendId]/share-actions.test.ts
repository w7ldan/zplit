import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/debtor-share-links", () => ({ createDebtorShareLink: mocks.create, revokeDebtorShareLink: mocks.revoke, DebtorShareReceiptSelectionError: class extends Error {} }));

import { createDebtorShareLinkAction, revokeDebtorShareLinkAction } from "./share-actions";

describe("debtor share actions", () => {
  it("binds creation to the authenticated owner and returns the raw token once", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.create.mockResolvedValue({ token: "11111111-1111-4111-8111-111111111111", expiresAt: new Date("2026-08-11T00:00:00Z") });

    mocks.createLedgerRepository.mockReturnValue({ getFriendDebtorStatement: vi.fn().mockResolvedValue({ friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }) });
    const result = await createDebtorShareLinkAction("friend-a", { error: "", link: null, statement: null, revoked: false }, new FormData());

    expect(mocks.create).toHaveBeenCalledWith("database", "owner-a", "friend-a");
    expect(result).toEqual({ error: "", link: { token: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-08-11T00:00:00.000Z" }, statement: { friendName: "Ada", assignedAmount: 1000, repaidAmount: 0, outstandingAmount: 1000 }, revoked: false, selectedReceiptIds: [] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/friends/friend-a");
  });

  it("revokes owner-scoped links without exposing a payment or editing action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.revoke.mockResolvedValue(true);

    await expect(revokeDebtorShareLinkAction("friend-a", { error: "", link: null, statement: null, revoked: false }, new FormData())).resolves.toEqual({ error: "", link: null, statement: null, revoked: true });
    expect(mocks.revoke).toHaveBeenCalledWith("database", "owner-a", "friend-a");
  });

  it("reports when replacement committed before a later lookup failed", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.create.mockResolvedValue({ token: "11111111-1111-4111-8111-111111111111", expiresAt: new Date("2026-08-11T00:00:00Z") });
    mocks.createLedgerRepository.mockReturnValue({ getFriendDebtorStatement: vi.fn().mockRejectedValue(new Error("lookup failed")) });

    await expect(createDebtorShareLinkAction("friend-a", { error: "", link: null, statement: null, revoked: false }, new FormData())).resolves.toMatchObject({ error: "This friend is no longer available.", replacementCommitted: true });
  });
});
