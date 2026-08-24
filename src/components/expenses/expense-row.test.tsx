import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpenseRow } from "./expense-row";

describe("ExpenseRow", () => {
  it("exposes description, amount, date, outing, and action fields", () => {
    render(<ExpenseRow expense={{ id: "expense-a", description: "Dinner", amount: 84_000, outingTitle: "Friday night", outingOccurredAt: new Date("2026-01-01T00:00:00Z") }} />);

    for (const label of ["Amount", "Date", "Outing"]) expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toHaveAttribute("aria-label", "Expense amount Rp 84.000");
    expect(screen.getByRole("link", { name: /Edit/ })).toBeInTheDocument();
  });

  it("keeps an unbroken description in the rendered row", () => {
    const description = "expense-" + "z".repeat(240);
    render(<ExpenseRow expense={{ id: "expense-a", description, amount: 84_000, outingTitle: "Dinner", outingOccurredAt: new Date("2026-01-01T00:00:00Z") }} />);

    expect(screen.getByRole("link", { name: description })).toBeInTheDocument();
  });
});
