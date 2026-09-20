import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RepaymentRow } from "./repayment-row";

describe("RepaymentRow", () => {
  it("shows received, applied, and needs-allocation accounting as one navigable row", () => {
    render(<RepaymentRow vnext repayment={{ id: "repayment-a", friendName: "Ari", friendArchivedAt: new Date("2026-01-01T00:00:00Z"), amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paidOn: null, paymentMethod: "Cash", allocatedAmount: 84_000, unallocatedAmount: 0 }} />);

    expect(screen.getByText("Received", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Applied to shares", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Needs allocation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Fully applied", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 84.000", { exact: true })).toHaveLength(2);
    expect(screen.getByText("ARCHIVED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Cash", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ari" })).toHaveClass("vnext-row");
  });

  it("shows the exact remaining allocation amount", () => {
    render(<RepaymentRow vnext repayment={{ id: "repayment-a", friendName: "Ari", friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paidOn: null, paymentMethod: null, allocatedAmount: 40_000, unallocatedAmount: 44_000 }} />);

    expect(screen.getByText("Rp 44.000 needs allocation", { exact: true })).toBeInTheDocument();
  });

  it("keeps unbroken friend and payment method values in the rendered row", () => {
    const friendName = "friend-" + "x".repeat(240);
    const paymentMethod = "method-" + "m".repeat(240);
    render(<RepaymentRow vnext repayment={{ id: "repayment-a", friendName, friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paidOn: null, paymentMethod, allocatedAmount: 40_000, unallocatedAmount: 44_000 }} />);

    expect(screen.getByRole("link", { name: friendName })).toBeInTheDocument();
    expect(screen.getByText(paymentMethod)).toBeInTheDocument();
    expect(screen.getByText("Received", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Applied to shares", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Needs allocation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000 needs allocation", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: friendName })).toHaveAttribute("href", "/app/repayments/repayment-a");
  });
});
