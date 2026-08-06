import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpenseRow } from "./expense-row";

describe("ExpenseRow", () => {
  it("keeps an unbroken description in the rendered row", () => {
    const description = "expense-" + "z".repeat(240);
    render(<ExpenseRow expense={{ id: "expense-a", ownerUserId: "owner-a", outingId: "outing-a", description, amount: 84_000, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), outingTitle: "Dinner", outingOccurredAt: new Date("2026-01-01T00:00:00Z") }} />);

    expect(screen.getByRole("link", { name: description })).toBeInTheDocument();
  });
});
