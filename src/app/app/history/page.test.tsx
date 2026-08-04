import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HistoryPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

describe("history page", () => {
  it("loads the selected filter and opaque cursor through the session owner", async () => {
    const listLedgerHistory = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listLedgerHistory });
    render(await HistoryPage({ searchParams: Promise.resolve({ type: "repayment", cursor: "lh1.cursor" }) }));
    expect(screen.getByRole("heading", { name: "Ledger history" })).toBeInTheDocument();
    expect(listLedgerHistory).toHaveBeenCalledWith({ type: "repayment", cursor: "lh1.cursor" });
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
  });
});
