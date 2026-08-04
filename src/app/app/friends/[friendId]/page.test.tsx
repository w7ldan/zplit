import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FriendRecordPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

const friend = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  name: "Ada Lovelace",
  phoneNumber: null,
  notes: "First record",
  archivedAt: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("friend record", () => {
  it("renders identity, metadata, edit fields, and archive action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getFriend: vi.fn().mockResolvedValue(friend) });
    render(await FriendRecordPage({ params: Promise.resolve({ friendId: friend.id }) }));

    expect(screen.getByText("Friend · editable record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("02 Jan 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Archive friend" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to friends/ })).toHaveAttribute("href", "/app/friends");
  });

  it("uses the same not-found path for an absent or foreign record", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ getFriend: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(FriendRecordPage({ params: Promise.resolve({ friendId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
