import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripRecordPage from "./page";
import { LedgerNotFoundError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => ({ ...(await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository")), createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

const trip = { id: "11111111-1111-4111-8111-111111111111", ownerUserId: "owner-a", name: "Bali 2026", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: "Bring receipts.", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
const outingPage = { items: [], page: 1, pageSize: 20 as const, totalItems: 0, totalPages: 1 };

describe("Trip record", () => {
  it("renders summary, paginated outings, contextual Add outing, and delete copy", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getTrip: vi.fn().mockResolvedValue(trip), getTripSummary: vi.fn().mockResolvedValue({ outingCount: 2, expenseCount: 3, expenseTotal: 184_000, totalAssignedAmount: 126_500, ownerPortionAmount: 57_500, totalOutstandingAmount: 26_500 }), listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await TripRecordPage({ params: Promise.resolve({ tripId: trip.id }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Bali 2026" })).toBeInTheDocument();
    expect(screen.getByText("12 Apr 2026 – 16 Apr 2026")).toBeInTheDocument();
    expect(within(document.querySelector(".trip-record__intro")!).getByRole("link", { name: "Add outing" })).toHaveAttribute("href", `/app/outings?create=1&trip=${trip.id}`);
    expect(within(document.querySelector(".ledger-empty")!).getByRole("link", { name: "Add outing" })).toHaveAttribute("href", `/app/outings?create=1&trip=${trip.id}`);
    expect(screen.getByText("Total spending")).toBeInTheDocument();
    expect(screen.getByText("Rp 184.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 126.500")).toBeInTheDocument();
    expect(screen.getByText("Rp 57.500")).toBeInTheDocument();
    expect(screen.getByText("Rp 26.500")).toBeInTheDocument();
    expect(screen.getByText(/no expenses or financial ledger data are deleted/i)).toBeInTheDocument();
  });

  it("renders zero financial totals for an empty Trip", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getTrip: vi.fn().mockResolvedValue(trip), getTripSummary: vi.fn().mockResolvedValue({ outingCount: 0, expenseCount: 0, expenseTotal: 0, totalAssignedAmount: 0, ownerPortionAmount: 0, totalOutstandingAmount: 0 }), listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await TripRecordPage({ params: Promise.resolve({ tripId: trip.id }) }));
    expect(screen.getAllByText("Rp 0")).toHaveLength(4);
  });

  it("maps foreign Trips to notFound", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getTrip: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });
    await expect(TripRecordPage({ params: Promise.resolve({ tripId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
