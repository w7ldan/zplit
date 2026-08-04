import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn() }));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));

describe("exports page", () => {
  it("requires a session and exposes the three on-demand CSV downloads", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    render(await ExportsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Ledger exports" })).toBeInTheDocument();
    expect(screen.getByText(/signed-in user’s current ledger/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Download CSV/ })[0]).toHaveAttribute("href", "/app/exports/balances.csv");
    expect(screen.getAllByRole("link", { name: /Download CSV/ })[1]).toHaveAttribute("href", "/app/exports/expense-shares.csv");
    expect(screen.getAllByRole("link", { name: /Download CSV/ })[2]).toHaveAttribute("href", "/app/exports/repayments.csv");
    expect(document.querySelectorAll(".exports-row")).toHaveLength(3);
  });
});
