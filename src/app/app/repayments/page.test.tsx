import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepaymentsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }));

const activeFriend = { id: "11111111-1111-4111-8111-111111111111", name: "Ari", archivedAt: null };
const archivedFriend = { id: "22222222-2222-4222-8222-222222222222", name: "Bima", archivedAt: new Date("2026-01-01T00:00:00.000Z") };
const summary = { friendBalances: [{ friendId: activeFriend.id, name: "Ari", archived: false, assignedAmount: 84_000, repaidAmount: 20_000, outstandingAmount: 64_000 }] };
const repayment = { id: "repayment-a", friendName: "Ari", friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", allocatedAmount: 40_000, unallocatedAmount: 44_000 };

describe("/app/repayments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects empty controlled parameters to the canonical URL", async () => {
    await expect(RepaymentsPage({ searchParams: Promise.resolve({ allocation: "", friendId: "", q: "" }) })).rejects.toThrow("redirect:/app/repayments");
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("preserves task-panel and unrelated parameters while canonicalizing", async () => {
    await expect(RepaymentsPage({ searchParams: Promise.resolve({ allocation: "", friendId: "", q: "", create: "1", task: "confirm", source: "ledger" }) })).rejects.toThrow("redirect:/app/repayments?create=1&task=confirm&source=ledger");
  });

  it("keeps allocation state explicit and provides outstanding friend context", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const getBalances = vi.fn().mockResolvedValue(summary.friendBalances);
    const openShares = vi.fn().mockResolvedValue({});
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords: vi.fn().mockResolvedValue({ items: [repayment], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }), searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }, { id: archivedFriend.id, name: archivedFriend.name, archived: true }]), getFriendBalances: getBalances, listOpenExpenseSharesByFriend: openShares });
    render(await RepaymentsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Repayments" })).toBeInTheDocument();
    expect(screen.getByText("Repayments · money returned")).toBeInTheDocument();
    expect(screen.getByText("Record money received and apply it to outstanding expense shares.")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 repayment found.");
    expect(screen.getByText("Filters", { selector: "summary" })).toBeInTheDocument();
    expect((screen.getByText("Filters", { selector: "summary" }).parentElement as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Repayments" }).closest("section")).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("link", { name: "Add repayment" })).toHaveAttribute("href", "/app/repayments?create=1");
    expect(screen.getByLabelText("Allocation")).toHaveValue("");
    expect(screen.getByLabelText("Allocation")).toHaveAttribute("name", "allocation");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
    expect(getBalances).not.toHaveBeenCalled();
    expect(openShares).not.toHaveBeenCalled();
  });

  it("passes the normalized browser offset to repayment filtering and grouping", async () => {
    const boundaryRepayment = { ...repayment, paidAt: new Date("2026-06-30T17:00:00.000Z") };
    const listRepaymentRecords = vi.fn().mockResolvedValue({ items: [boundaryRepayment], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords, searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }, { id: archivedFriend.id, name: archivedFriend.name, archived: true }]) });

    render(await RepaymentsPage({ searchParams: Promise.resolve({ month: "2026-07", tz: "-420" }) }));

    expect(screen.getByText("JULY 2026")).toBeInTheDocument();
    expect(listRepaymentRecords).toHaveBeenCalledWith({ q: undefined, friendId: undefined, month: "2026-07", allocation: undefined, page: undefined, timezoneOffsetMinutes: -420 });
  });

  it("opens the repayment form only with create=1 and retains archived friends", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const getContext = vi.fn().mockResolvedValue({ option: { id: activeFriend.id, name: activeFriend.name, archived: false }, outstandingAmount: 64_000, openExpenseShares: [] });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }), searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }, { id: archivedFriend.id, name: archivedFriend.name, archived: true }]), getRepaymentFriendContext: getContext });
    render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
    expect(screen.getByText(/Outstanding for Ari/)).toBeInTheDocument();
  });

  it("offers a safe friend continuation when Add repayment has no friends", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      listRepaymentRecords: vi.fn().mockResolvedValue({ items: [], page: 2, pageSize: 20, totalItems: 0, totalPages: 1 }),
      searchFriends: vi.fn().mockResolvedValue([]),
      getFriendBalances: vi.fn().mockResolvedValue([]),
      listOpenExpenseSharesByFriend: vi.fn().mockResolvedValue({}),
    });
    render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1", q: "Cash", month: "2026-04", page: "2", source: "ledger" }) }));

    const returnTo = "%2Fapp%2Frepayments%3Fcreate%3D1%26q%3DCash%26month%3D2026-04%26page%3D2%26source%3Dledger";
    expect(screen.getByText("Add a friend before recording money received.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a friend and continue" })).toHaveAttribute("href", `/app/friends?create=1&returnTo=${returnTo}`);
    expect(within(screen.getByRole("dialog")).queryByLabelText("Friend")).not.toBeInTheDocument();
  });

  it("preselects an owner friend for returned and manually opened repayment entry", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const listRepaymentRecords = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords, searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }]), getRepaymentFriendContext: vi.fn().mockResolvedValue({ option: { id: activeFriend.id, name: activeFriend.name, archived: false }, outstandingAmount: 64_000, openExpenseShares: [] }) });
    render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1", friendId: activeFriend.id }) }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Friend" })).toHaveValue(activeFriend.name);
    expect(listRepaymentRecords).toHaveBeenCalledWith({ q: undefined, friendId: activeFriend.id, month: undefined, allocation: undefined, page: undefined, timezoneOffsetMinutes: undefined });
  });

  it("does not preselect malformed or foreign friends", async () => {
    for (const friendId of ["not-a-uuid", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]) {
      mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
      const listRepaymentRecords = vi.fn().mockResolvedValue({ items: [repayment], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
      const getContext = vi.fn().mockResolvedValue({ option: { id: activeFriend.id, name: activeFriend.name, archived: false }, outstandingAmount: 64_000, openExpenseShares: [] });
      mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords, searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }]), getRepaymentFriendContext: getContext });
      const view = render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1", friendId }) }));
      expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Friend" })).toHaveValue(activeFriend.name);
      expect(getContext).toHaveBeenCalledWith(activeFriend.id, true);
      expect(listRepaymentRecords).toHaveBeenCalledWith({ q: undefined, friendId: undefined, month: undefined, allocation: undefined, page: undefined, timezoneOffsetMinutes: undefined });
      expect(screen.getByRole("status")).toHaveTextContent("1 repayment found.");
      expect(screen.queryByText("Foreign friend")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("does not preserve an invalid friend context in filter or pagination state", async () => {
    const invalidFriendId = "33333333-3333-4333-8333-333333333333";
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const listRepaymentRecords = vi.fn().mockResolvedValue({ items: [repayment], page: 1, pageSize: 20, totalItems: 21, totalPages: 2 });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords, searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }]), getRepaymentFriendContext: vi.fn().mockResolvedValue({ option: { id: activeFriend.id, name: activeFriend.name, archived: false }, outstandingAmount: 64_000, openExpenseShares: [] }) });

    render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1", friendId: invalidFriendId, q: "Cash", page: "1", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add repayment" })).toHaveAttribute("href", "/app/repayments?create=1&q=Cash&page=1&task=open&source=ledger");
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/repayments?create=1&task=open&source=ledger");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/repayments?create=1&q=Cash&page=2&task=open&source=ledger#record-list");
    expect(screen.getByText("Filters", { selector: "summary" })).toBeInTheDocument();
    expect(screen.queryByText(invalidFriendId)).not.toBeInTheDocument();
  });

  it("preserves retrieval context when opening Add repayment", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords: vi.fn().mockResolvedValue({ items: [repayment], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }), searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }, { id: archivedFriend.id, name: archivedFriend.name, archived: true }]) });
    render(await RepaymentsPage({ searchParams: Promise.resolve({ q: "Cash", friendId: activeFriend.id, month: "2026-04", allocation: "needs", page: "2", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add repayment" })).toHaveAttribute("href", `/app/repayments?q=Cash&friendId=${activeFriend.id}&month=2026-04&allocation=needs&page=2&task=open&source=ledger&create=1`);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/repayments?task=open&source=ledger");
    expect(screen.getByText("Filters (3)", { selector: "summary" })).toBeInTheDocument();
  });

  it("announces the total matching repayments rather than the current page", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listRepaymentRecords: vi.fn().mockResolvedValue({ items: [repayment], page: 2, pageSize: 20, totalItems: 12, totalPages: 1 }), searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: activeFriend.name, archived: false }]), getFriendBalances: vi.fn(), listOpenExpenseSharesByFriend: vi.fn() });
    render(await RepaymentsPage());
    expect(screen.getByRole("status")).toHaveTextContent("12 repayments found.");
  });

  it("renders a bounded page and keeps long friend and payment method values available to the row", async () => {
    const friendName = "friend-" + "x".repeat(240);
    const paymentMethod = "method-" + "m".repeat(240);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      listRepaymentRecords: vi.fn().mockResolvedValue({ items: [{ ...repayment, friendName, paymentMethod }], page: 2, pageSize: 20, totalItems: 41, totalPages: 3 }),
      searchFriends: vi.fn().mockResolvedValue([{ id: activeFriend.id, name: friendName, archived: false }]),
    });

    render(await RepaymentsPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByRole("link", { name: friendName })).toBeInTheDocument();
    expect(screen.getByText(paymentMethod)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/repayments?page=3#record-list");
  });
});
