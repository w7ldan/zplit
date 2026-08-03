import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FriendsPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const friend = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  name: "Ada Lovelace",
  phoneNumber: "+62 811",
  notes: null,
  archivedAt: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("/app/friends", () => {
  it("renders active records and the direct add form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listFriends: vi.fn().mockResolvedValue([friend]) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "active" }) }));

    expect(screen.getByText("07 / FRIENDS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "People in your ledger." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("+62 811")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("02 Jan 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit record/ })).toHaveAttribute("href", `/app/friends/${friend.id}`);
    expect(screen.getByRole("heading", { level: 2, name: "Add a friend" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Archived/ })).toHaveAttribute("href", "/app/friends?view=archived");
    expect(document.body).not.toHaveTextContent(/balance|status dot|pill|dashboard/i);
  });

  it("renders an intentional archived empty state", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriends: vi.fn().mockResolvedValue([]) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "archived" }) }));

    expect(screen.getByText("No archived friends yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Active/ })).toHaveAttribute("href", "/app/friends?view=active");
  });
});
