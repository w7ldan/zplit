import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutingsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };

describe("/app/outings", () => {
  it("shows chronological event context, expense count/total, and direct expense action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutings: vi.fn().mockResolvedValue([outing]), listExpenses: vi.fn().mockResolvedValue([{ id: "expense-a", outingId: outing.id, amount: 84_000, outingTitle: outing.title, outingOccurredAt: outing.occurredAt }]) });
    render(await OutingsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Shared moments, clearly recorded." })).toBeInTheDocument();
    expect(screen.getByText("1 expense · Rp 84.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?create=1&outing=${outing.id}`);
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("opens the outing form only with create=1", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutings: vi.fn().mockResolvedValue([]), listExpenses: vi.fn().mockResolvedValue([]) });
    render(await OutingsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });
});
