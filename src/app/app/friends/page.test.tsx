import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FriendsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const friend = { id: "friend-a", ownerUserId: "owner-a", name: "Ada Lovelace", phoneNumber: "+62 811", notes: null, archivedAt: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const summary = { friendBalances: [{ friendId: "friend-a", name: "Ada Lovelace", archived: false, assignedAmount: 84_000, repaidAmount: 20_000, outstandingAmount: 64_000 }] };
const friendPage = { items: [friend], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe("/app/friends", () => {
  it("renders search, balance context, and no permanent creation form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listFriendRecords: vi.fn().mockResolvedValue(friendPage), getLedgerSummary: vi.fn().mockResolvedValue(summary) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "active", q: "Ada" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Friends" })).toBeInTheDocument();
    expect(screen.getByText("Friends · people you split with")).toBeInTheDocument();
    expect(screen.getByText("Find people connected to your shared expenses and review what remains open.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/owner records|owner-scoped ledger|chronological ledger/);
    expect(screen.getByLabelText("Search friends")).toHaveValue("Ada");
    expect(screen.getByText("Rp 64.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add friend" })).toHaveAttribute("href", "/app/friends?create=1");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("only renders the creation form inside the URL-controlled panel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendRecords: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getLedgerSummary: vi.fn().mockResolvedValue(summary) });
    render(await FriendsPage({ searchParams: Promise.resolve({ create: "1" }) }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("keeps filter URLs, selection, and unrelated search parameters intact", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendRecords: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getLedgerSummary: vi.fn().mockResolvedValue(summary) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "archived", q: "Ada", create: "1", page: "2", task: "open" }) }));

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("href", "/app/friends?view=active&q=Ada&create=1&task=open");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("href", "/app/friends?view=archived&q=Ada&create=1&task=open");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Active" })).not.toHaveAttribute("aria-current");
  });
});
