import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OutingsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => ({ ...(await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository")), createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const outingPage = { items: [{ ...outing, expenseCount: 1, expenseTotal: 84_000 }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };
const trip = { id: "11111111-1111-4111-8111-111111111111", ownerUserId: "owner-a", name: "Bali 2026", startsOn: null, endsOn: null, notes: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z") };

describe("/app/outings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects empty controlled parameters to the canonical URL", async () => {
    await expect(OutingsPage({ searchParams: Promise.resolve({ q: "", month: "" }) })).rejects.toThrow("redirect:/app/outings");
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("preserves task-panel and unrelated parameters while canonicalizing", async () => {
    await expect(OutingsPage({ searchParams: Promise.resolve({ q: "", month: "", create: "1", task: "confirm", source: "ledger" }) })).rejects.toThrow("redirect:/app/outings?create=1&task=confirm&source=ledger");
  });

  it("shows chronological event context, expense count/total, and direct expense action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await OutingsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Outings" })).toBeInTheDocument();
    expect(document.querySelector(".records-workspace")!).toContainElement(document.querySelector(".outings-trips-switch"));
    expect(document.querySelector(".records-workspace")!).toContainElement(document.querySelector(".live-record-filters"));
    expect(document.querySelector(".records-workspace")!).toContainElement(document.querySelector(".ledger-list"));
    const viewSwitch = screen.getByRole("navigation", { name: "Outings and Trips views" });
    expect(within(viewSwitch).getByRole("link", { name: "Outings" })).toHaveAttribute("aria-current", "page");
    expect(within(viewSwitch).getByRole("link", { name: "Trips" })).toHaveAttribute("href", "/app/trips");
    expect(screen.getByText("Outings · shared events")).toBeInTheDocument();
    expect(screen.getByText("Keep related expenses together under the event where they happened.")).toBeInTheDocument();
    expect(within(document.querySelector(".outing-row")!).getByText("Trip", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Created", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("1 expense · Rp 84.000")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 outing found.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Outings" }).closest("section")).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?create=1&outing=${outing.id}`);
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("groups a UTC boundary outing in the browser's July 2026", async () => {
    const boundaryOuting = { ...outing, occurredAt: new Date("2026-06-30T17:00:00.000Z") };
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const listOutingRecords = vi.fn().mockResolvedValue({ ...outingPage, items: [{ ...boundaryOuting, expenseCount: 0, expenseTotal: 0 }] });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords });

    render(await OutingsPage({ searchParams: Promise.resolve({ month: "2026-07", tz: "-420" }) }));

    expect(screen.getByText("JULY 2026")).toBeInTheDocument();
    expect(listOutingRecords).toHaveBeenCalledWith({ q: undefined, month: "2026-07", page: undefined, timezoneOffsetMinutes: -420 });
  });

  it("opens the outing form only with create=1", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(within(document.querySelector(".ledger-empty")!).getByRole("link", { name: "Add outing" })).toHaveAttribute("href", "/app/outings?create=1");
  });

  it("preselects a valid Trip context in Add outing", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getTrip: vi.fn().mockResolvedValue(trip), listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ create: "1", trip: trip.id }) }));

    expect(screen.getByRole("dialog").querySelector("#outing-trip")).toHaveTextContent(trip.name);
    expect((screen.getByRole("dialog").querySelector('select[name="tripId"]') as HTMLSelectElement).value).toBe(trip.id);
  });

  it("sanitizes an unavailable Trip context", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getTrip: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(OutingsPage({ searchParams: Promise.resolve({ create: "1", trip: trip.id }) })).rejects.toThrow("redirect:/app/outings?create=1");
  });

  it("shows a filtered empty state with a narrow clear link", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ q: "missing", month: "2026-04", page: "3", create: "1", task: "confirm" }) }));
    expect(screen.getByRole("heading", { name: "No matching outings." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Clear filters/ })).toHaveAttribute("href", "/app/outings?create=1&task=confirm");
    expect(screen.getByRole("status")).toHaveTextContent("0 outings found.");
  });

  it("preserves retrieval context when opening Add outing", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await OutingsPage({ searchParams: Promise.resolve({ q: "Dinner", month: "2026-04", page: "2", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add outing" })).toHaveAttribute("href", "/app/outings?q=Dinner&month=2026-04&page=2&task=open&source=ledger&create=1");
  });

  it("removes an invalid return target before authentication or repository access", async () => {
    await expect(OutingsPage({ searchParams: Promise.resolve({ returnTo: "https://evil.example/app/expenses", q: "Dinner", month: "2026-04", page: "2", create: "1", created: "outing-a", source: "ledger" }) })).rejects.toThrow("redirect:/app/outings?q=Dinner&month=2026-04&page=2&create=1&created=outing-a&source=ledger");
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("preserves a valid return target through Add outing navigation", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await OutingsPage({ searchParams: Promise.resolve({ returnTo: "/app/expenses?create=1&q=Dinner", q: "Dinner", month: "2026-04", page: "2" }) }));

    expect(screen.getByRole("link", { name: "Add outing" })).toHaveAttribute("href", "/app/outings?returnTo=%2Fapp%2Fexpenses%3Fcreate%3D1%26q%3DDinner&q=Dinner&month=2026-04&page=2&create=1");
  });

  it("preserves a valid return target through the unfiltered empty-state Add outing link", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ returnTo: "/app/expenses?create=1&q=Dinner", page: "2", task: "open", source: "ledger" }) }));

    const href = "/app/outings?returnTo=%2Fapp%2Fexpenses%3Fcreate%3D1%26q%3DDinner&page=2&task=open&source=ledger&create=1";
    expect(within(document.querySelector(".ledger-empty")!).getByRole("link", { name: "Add outing" })).toHaveAttribute("href", href);
  });

  it("renders a bounded page and keeps long outing names available to the row", async () => {
    const title = "outing-" + "y".repeat(240);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [{ ...outing, title, expenseCount: 1, expenseTotal: 84_000 }], page: 2, totalItems: 41, totalPages: 3 }),
    });

    render(await OutingsPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/outings?page=3#record-list");
  });
});
