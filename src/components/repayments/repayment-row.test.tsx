import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RepaymentRow } from "./repayment-row";

describe("RepaymentRow", () => {
  it("uses one allocation state instead of separate accounting columns", () => {
    render(<RepaymentRow repayment={{ id: "repayment-a", friendName: "Ari", friendArchivedAt: new Date("2026-01-01T00:00:00Z"), amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paymentMethod: "Cash", allocatedAmount: 84_000, unallocatedAmount: 0 }} />);

    expect(screen.getByText("Received", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Allocation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Fully applied", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Applied to shares", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Needs allocation", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("ARCHIVED", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Cash", { exact: true })).toBeInTheDocument();
  });

  it("shows the exact remaining allocation amount", () => {
    render(<RepaymentRow repayment={{ id: "repayment-a", friendName: "Ari", friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paymentMethod: null, allocatedAmount: 40_000, unallocatedAmount: 44_000 }} />);

    expect(screen.getByText("Rp 44.000 needs allocation", { exact: true })).toBeInTheDocument();
  });

  it("keeps unbroken friend and payment method values in the rendered row", () => {
    const friendName = "friend-" + "x".repeat(240);
    const paymentMethod = "method-" + "m".repeat(240);
    render(<RepaymentRow repayment={{ id: "repayment-a", friendName, friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paymentMethod, allocatedAmount: 40_000, unallocatedAmount: 44_000 }} />);

    expect(screen.getByRole("link", { name: friendName })).toBeInTheDocument();
    expect(screen.getByText(paymentMethod)).toBeInTheDocument();
    expect(screen.getByText("Received", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Allocation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000 needs allocation", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Applied to shares", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Needs allocation", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Allocated", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Unallocated", { exact: true })).not.toBeInTheDocument();
  });
});
