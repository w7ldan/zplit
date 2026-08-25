import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FriendsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }));

const friend = { id: "friend-a", ownerUserId: "owner-a", name: "Ada Lovelace", phoneNumber: "+62 811", notes: null, archivedAt: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const summary = { friendBalances: [{ friendId: "friend-a", name: "Ada Lovelace", archived: false, assignedAmount: 84_000, repaidAmount: 20_000, outstandingAmount: 64_000 }] };
const friendPage = { items: [{ type: "local" as const, friend }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe("/app/friends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects empty controlled search parameters to the canonical URL", async () => {
    await expect(FriendsPage({ searchParams: Promise.resolve({ q: "" }) })).rejects.toThrow("redirect:/app/friends");
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("preserves task-panel and unrelated parameters while canonicalizing", async () => {
    await expect(FriendsPage({ searchParams: Promise.resolve({ q: "", create: "1", task: "confirm", source: "ledger" }) })).rejects.toThrow("redirect:/app/friends?create=1&task=confirm&source=ledger");
  });

  it("renders search, balance context, and no permanent creation form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const getFriendBalances = vi.fn().mockResolvedValue(summary.friendBalances);
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue(friendPage), getFriendBalances });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "active", q: "Ada" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Friends" })).toBeInTheDocument();
    expect(document.querySelector(".friends-toolbar")!).toContainElement(document.querySelector(".live-record-filters"));
    expect(document.querySelector(".friends-toolbar")!).toContainElement(document.querySelector(".friends-page__views"));
    expect(screen.getByText("Friends · people you split with")).toBeInTheDocument();
    expect(screen.getByText("Find people connected to your shared expenses and review what remains open.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/owner records|owner-scoped ledger|chronological ledger/);
    expect(screen.getByLabelText("Search friends")).toHaveValue("Ada");
    expect(screen.getByLabelText("Search friends")).toHaveAttribute("placeholder", "Name, phone number, or username");
    expect(screen.getByText("Rp 64.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add friend" })).toHaveAttribute("href", "/app/friends?view=active&q=Ada&create=1");
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/friends?view=active");
    expect(screen.getByRole("status")).toHaveTextContent("1 friend found.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Friends" }).closest("section")).not.toHaveAttribute("aria-live");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(getFriendBalances).toHaveBeenCalledExactlyOnceWith([friend.id]);
  });

  it("only renders the creation form inside the URL-controlled panel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getFriendBalances: vi.fn().mockResolvedValue(summary.friendBalances) });
    render(await FriendsPage({ searchParams: Promise.resolve({ create: "1" }) }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("makes an unfiltered empty Friends list actionable", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getFriendBalances: vi.fn().mockResolvedValue([]) });
    render(await FriendsPage());

    expect(within(document.querySelector(".ledger-empty")!).getByRole("link", { name: "Add friend" })).toHaveAttribute("href", "/app/friends?create=1");
  });

  it("renders an active registered Friend without balance lookup or a Friend detail route", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const getFriendBalances = vi.fn().mockResolvedValue([]);
    mocks.createLedgerRepository.mockReturnValue({
      listFriendsExperience: vi.fn().mockResolvedValue({ items: [{ type: "connection", connection: { type: "connection", id: "connection-a", userId: "user-a", name: "Alice Tan", username: "alice", requestId: "request-a" } }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }),
      getFriendBalances,
    });

    render(await FriendsPage());

    const row = document.querySelector<HTMLElement>(".friend-row")!;
    expect(within(row).getByText("Alice Tan")).toBeInTheDocument();
    expect(within(row).getByText("@alice")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(getFriendBalances).not.toHaveBeenCalled();
  });

  it("removes an invalid return target before authentication or repository access", async () => {
    await expect(FriendsPage({ searchParams: Promise.resolve({ returnTo: "https://evil.example/app/repayments", view: "archived", q: "Ada", page: "2", create: "1", created: "friend-a", confirmation: "yes", source: "ledger" }) })).rejects.toThrow("redirect:/app/friends?view=archived&q=Ada&page=2&create=1&created=friend-a&confirmation=yes&source=ledger");
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("keeps filter URLs, selection, and unrelated search parameters intact", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getFriendBalances: vi.fn().mockResolvedValue(summary.friendBalances) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "archived", q: "Ada", create: "1", page: "2", task: "open" }) }));

    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("href", "/app/friends?view=active&q=Ada&create=1&task=open");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("href", "/app/friends?view=archived&q=Ada&create=1&task=open");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Active" })).not.toHaveAttribute("aria-current");
  });

  it("preserves retrieval context when opening Add friend", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue(friendPage), getFriendBalances: vi.fn().mockResolvedValue(summary.friendBalances) });
    render(await FriendsPage({ searchParams: Promise.resolve({ view: "archived", q: "Ada", page: "2", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add friend" })).toHaveAttribute("href", "/app/friends?view=archived&q=Ada&page=2&task=open&source=ledger&create=1");
  });

  it("preserves a valid repayment return target through filters, views, pagination, and Add friend", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [], page: 2, totalItems: 0, totalPages: 3 }), getFriendBalances: vi.fn().mockResolvedValue(summary.friendBalances) });
    render(await FriendsPage({ searchParams: Promise.resolve({ returnTo: "/app/repayments?create=1&source=ledger", view: "archived", q: "Ada", page: "2", create: "1", task: "open" }) }));

    const returnTo = "%2Fapp%2Frepayments%3Fcreate%3D1%26source%3Dledger";
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("href", `/app/friends?returnTo=${returnTo}&view=active&q=Ada&create=1&task=open`);
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute("href", `/app/friends?returnTo=${returnTo}&view=archived&q=Ada&create=1&task=open`);
    expect(screen.getByRole("link", { name: "Add friend" })).toHaveAttribute("href", `/app/friends?returnTo=${returnTo}&view=archived&q=Ada&page=2&create=1&task=open`);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", `/app/friends?returnTo=${returnTo}&view=archived&create=1&task=open`);
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", `/app/friends?returnTo=${returnTo}&view=archived&q=Ada&page=3&create=1&task=open#record-list`);
  });

  it("keeps the continuation server-bound instead of rendering it in the friend form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [], totalItems: 0, totalPages: 1 }), getFriendBalances: vi.fn().mockResolvedValue(summary.friendBalances) });
    render(await FriendsPage({ searchParams: Promise.resolve({ returnTo: "/app/repayments?create=1", create: "1" }) }));

    expect(within(screen.getByRole("dialog")).queryByDisplayValue("/app/repayments?create=1")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByDisplayValue(/repayments/)).not.toBeInTheDocument();
  });

  it("renders a bounded page and keeps long friend names available to the row", async () => {
    const name = "friend-" + "x".repeat(240);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({
      listFriendsExperience: vi.fn().mockResolvedValue({ ...friendPage, items: [{ type: "local", friend: { ...friend, name } }], page: 2, totalItems: 41, totalPages: 3 }),
      getFriendBalances: vi.fn().mockResolvedValue([]),
    });

    render(await FriendsPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/friends?page=3#record-list");
  });
});
