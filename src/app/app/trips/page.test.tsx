import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }));

const trip = { id: "trip-a", ownerUserId: "owner-a", name: "Bali 2026", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), outingCount: 2, expenseCount: 3, expenseTotal: 84_000 };
const page = { items: [trip], page: 1, pageSize: 20 as const, totalItems: 1, totalPages: 1 };

describe("/app/trips", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders bounded Trip records, search, and create TaskPanel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listTripRecords: vi.fn().mockResolvedValue(page) });
    render(await TripsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Trips" })).toBeInTheDocument();
    const viewSwitch = screen.getByRole("navigation", { name: "Outings and Trips views" });
    expect(within(viewSwitch).getByRole("link", { name: "Trips" })).toHaveAttribute("aria-current", "page");
    expect(within(viewSwitch).getByRole("link", { name: "Outings" })).toHaveAttribute("href", "/app/outings");
    expect(screen.getByText("Trips · grouped outings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add trip" })).toHaveAttribute("href", "/app/trips?create=1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bali 2026" })).toHaveAttribute("href", "/app/trips/trip-a");
  });

  it("renders the clear empty state for a filtered page", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listTripRecords: vi.fn().mockResolvedValue({ ...page, items: [], totalItems: 0 }) });
    render(await TripsPage({ searchParams: Promise.resolve({ q: "missing" }) }));
    expect(screen.getByRole("heading", { name: "No matching Trips." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/trips");
  });
});
