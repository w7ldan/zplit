import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutingRow } from "./outing-row";

describe("OutingRow", () => {
  it("keeps the outing metadata and grouped actions available", () => {
    render(<OutingRow outing={{ id: "outing-a", ownerUserId: "owner-a", title: "Dinner", occurredAt: new Date("2026-01-01T00:00:00Z"), notes: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") }} expenseCount={2} expenseTotal={84_000} />);

    for (const label of ["Date", "Expenses", "Created"]) expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add expense/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toBeInTheDocument();
  });

  it("keeps an unbroken outing name in the rendered row", () => {
    const title = "outing-" + "y".repeat(240);
    render(<OutingRow outing={{ id: "outing-a", ownerUserId: "owner-a", title, occurredAt: new Date("2026-01-01T00:00:00Z"), notes: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") }} expenseCount={1} expenseTotal={84_000} />);

    expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
  });
});
