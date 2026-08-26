import { describe, expect, it, vi } from "vitest";
import { searchGlobalRecords } from "./actions";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});

describe("global search action", () => {
  it("binds one search to the authenticated owner", async () => {
    const search = vi.fn().mockResolvedValue([]);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ searchGlobalRecords: search });

    await expect(searchGlobalRecords("Dinner")).resolves.toEqual([]);
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(search).toHaveBeenCalledWith("Dinner");
  });
});
