import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutingsPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const outing = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  title: "Jakarta dinner",
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  notes: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("/app/outings", () => {
  it("renders active outing rows and the direct add form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await OutingsPage());

    expect(screen.getByText("08 / OUTINGS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Shared moments, clearly recorded." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Jakarta dinner" })).toBeInTheDocument();
    expect(document.querySelector(`time[datetime="${outing.occurredAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", `/app/outings/${outing.id}`);
    expect(screen.getByRole("heading", { level: 2, name: "Add an outing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Date and time")).toHaveAttribute("type", "datetime-local");
    expect(document.body).not.toHaveTextContent(/balance|pill|avatar|status dot|expense total|dashboard/i);
  });

  it("renders an intentional empty state without unfinished navigation", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ listOutings: vi.fn().mockResolvedValue([]) });
    render(await OutingsPage());

    expect(screen.getByText("No outings yet.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/expense total|repayment data|balance|chart|dashboard/i);
  });
});
