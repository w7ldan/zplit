import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutingsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const outingPage = { items: [{ ...outing, expenseCount: 1, expenseTotal: 84_000 }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe("/app/outings", () => {
  it("shows chronological event context, expense count/total, and direct expense action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue(outingPage) });
    render(await OutingsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Outings" })).toBeInTheDocument();
    expect(screen.getByText("Outings · shared events")).toBeInTheDocument();
    expect(screen.getByText("Keep related expenses together under the event where they happened.")).toBeInTheDocument();
    expect(screen.getByText("1 expense · Rp 84.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?create=1&outing=${outing.id}`);
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("opens the outing form only with create=1", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("shows a filtered empty state with a narrow clear link", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listOutingRecords: vi.fn().mockResolvedValue({ ...outingPage, items: [], totalItems: 0, totalPages: 1 }) });
    render(await OutingsPage({ searchParams: Promise.resolve({ q: "missing", month: "2026-04", page: "3", create: "1", task: "confirm" }) }));
    expect(screen.getByRole("heading", { name: "No matching outings." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Clear filters/ })).toHaveAttribute("href", "/app/outings?create=1&task=confirm");
  });
});
