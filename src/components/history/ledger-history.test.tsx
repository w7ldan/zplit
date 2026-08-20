import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LedgerHistory } from "./ledger-history";

const items = [
  {
    type: "expense" as const,
    id: "expense-a",
    description: "Dinner",
    outingTitle: "Saturday",
    outingOccurredAt: new Date("2026-08-04T00:00:00.000Z"),
    totalAmount: 10000,
    assignedAmount: 4000,
    ownerPortionAmount: 6000,
  },
  {
    type: "repayment" as const,
    id: "repayment-a",
    friendId: "friend-a",
    friendName: "Ari",
    paidAt: new Date("2026-08-03T00:00:00.000Z"),
    totalAmount: 3000,
    allocatedAmount: 2000,
    unallocatedAmount: 1000,
  },
];

describe("LedgerHistory", () => {
  it("renders explicit values and detail links without status decorations", () => {
    render(<LedgerHistory items={items} type="all" nextCursor="lh1.cursor" />);
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(screen.getByRole("link", { name: /Ari/ })).toHaveAttribute("href", "/app/repayments/repayment-a");
    expect(screen.getByText("Rp 10.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 6.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 1.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next page/ })).toHaveAttribute("href", "/app/history?type=all&cursor=lh1.cursor");
    expect(document.body).not.toHaveTextContent(/card|pill|status dot|chart/i);
  });

  it("preserves the selected filter on the next-page link", () => {
    render(<LedgerHistory items={[items[1]!]} type="repayment" nextCursor="lh1.next" />);
    const filters = screen.getByRole("navigation", { name: "History filters" });
    expect(within(filters).getByRole("link", { name: "Repayments" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Next page/ })).toHaveAttribute("href", "/app/history?type=repayment&cursor=lh1.next");
  });

  it("has a clear empty state", () => {
    render(<LedgerHistory items={[]} type="expense" nextCursor={null} />);
    expect(screen.getByRole("heading", { name: "No ledger history yet." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/app/expenses?create=1");
    expect(screen.queryByRole("link", { name: /Next page/ })).not.toBeInTheDocument();
  });

  it("points an empty repayment history to the repayment flow", () => {
    render(<LedgerHistory items={[]} type="repayment" nextCursor={null} />);
    expect(screen.getByRole("link", { name: "Record repayment" })).toHaveAttribute("href", "/app/repayments?create=1");
  });
});
