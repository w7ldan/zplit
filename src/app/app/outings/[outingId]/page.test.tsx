import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutingRecordPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

const outing = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  title: "Jakarta dinner",
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  notes: "Bring the receipt.",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

describe("outing record", () => {
  it("renders identity, metadata, notes, and edit fields", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockResolvedValue(outing) });
    render(await OutingRecordPage({ params: Promise.resolve({ outingId: outing.id }) }));

    expect(screen.getByText("08 / OUTING RECORD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Jakarta dinner" })).toBeInTheDocument();
    expect(document.querySelector(`time[datetime="${outing.occurredAt.toISOString()}"]`)).toBeInTheDocument();
    expect(document.querySelector(`time[datetime="${outing.createdAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring the receipt.");
    expect(screen.getByLabelText("Title")).toHaveValue("Jakarta dinner");
    expect(screen.getByRole("link", { name: /Back to outings/ })).toHaveAttribute("href", "/app/outings");
    expect(screen.getByText(/Expenses can now be recorded separately/)).toBeInTheDocument();
  });

  it("uses the same not-found path for absent and foreign outings", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(OutingRecordPage({ params: Promise.resolve({ outingId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
