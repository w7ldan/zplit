import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RepaymentRow } from "./repayment-row";

describe("RepaymentRow", () => {
  it("keeps unbroken friend and payment method values in the rendered row", () => {
    const friendName = "friend-" + "x".repeat(240);
    const paymentMethod = "method-" + "m".repeat(240);
    render(<RepaymentRow repayment={{ id: "repayment-a", friendName, friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-01T00:00:00Z"), paymentMethod, allocatedAmount: 40_000, unallocatedAmount: 44_000 }} />);

    expect(screen.getByRole("link", { name: friendName })).toBeInTheDocument();
    expect(screen.getByText(paymentMethod)).toBeInTheDocument();
  });
});
