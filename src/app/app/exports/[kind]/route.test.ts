import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.getSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

import { GET } from "./route";

const emptySnapshot = { friends: [], expenses: [], expenseShares: [], repayments: [], repaymentAllocations: [] };

describe("ledger export route", () => {
  it("returns a generic 401 without loading export data", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await GET(new Request("http://zplit.test/app/exports/balances.csv"), { params: Promise.resolve({ kind: "balances.csv" }) });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("authenticates independently and returns private CSV headers and a fixed filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.headers.mockResolvedValue(new Headers({ cookie: "session=one" }));
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getLedgerExportSnapshot: vi.fn().mockResolvedValue(emptySnapshot) });

    const response = await GET(new Request("http://zplit.test/app/exports/balances.csv?owner=other&filename=bad"), { params: Promise.resolve({ kind: "balances.csv" }) });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("friend_name,friend_state");
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="zplit-balances-2026-08-05.csv"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    vi.useRealTimers();
  });

  it("returns 404 for unknown export kinds", async () => {
    mocks.createLedgerRepository.mockClear();
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    const response = await GET(new Request("http://zplit.test/app/exports/other.csv"), { params: Promise.resolve({ kind: "other.csv" }) });
    expect(response.status).toBe(404);
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });
});
