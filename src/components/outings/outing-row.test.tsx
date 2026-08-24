import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutingRow } from "./outing-row";

describe("OutingRow", () => {
  it("keeps the outing metadata and grouped actions available", () => {
    render(<OutingRow outing={{ id: "outing-a", title: "Dinner", occurredAt: new Date("2026-01-01T00:00:00Z") }} expenseCount={2} expenseTotal={84_000} />);

    for (const label of ["Date", "Trip", "Expenses"]) expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Created", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add expense/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toBeInTheDocument();
  });

  it("links a grouped Trip and leaves the dense ledger unlinked value compact", () => {
    render(<OutingRow outing={{ id: "outing-a", title: "Dinner", occurredAt: new Date("2026-01-01T00:00:00Z"), tripId: "trip-a", tripName: "Bandung" }} expenseCount={2} expenseTotal={84_000} />);

    expect(screen.getByRole("link", { name: "Bandung" })).toHaveAttribute("href", "/app/trips/trip-a");
  });

  it("keeps an unbroken outing name in the rendered row", () => {
    const title = "outing-" + "y".repeat(240);
    render(<OutingRow outing={{ id: "outing-a", title, occurredAt: new Date("2026-01-01T00:00:00Z") }} expenseCount={1} expenseTotal={84_000} />);

    expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
  });
});
