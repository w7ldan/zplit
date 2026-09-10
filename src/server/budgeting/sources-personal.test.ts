import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildRepaymentBudgetDistribution } from "./sources-personal";

describe("Personal repayment budget distribution", () => {
  const categoryByExpense = new Map([["expense-food", "category-food"], ["expense-transport", "category-transport"]]);

  it("maps and aggregates allocated categories while crediting the remainder to Uncategorized", () => {
    expect(buildRepaymentBudgetDistribution(300, [
      { expenseId: "expense-food", amount: 100 },
      { expenseId: "expense-food", amount: 100 },
      { expenseId: "expense-transport", amount: 50 },
    ], "category-uncategorized", categoryByExpense)).toEqual(new Map([
      ["category-food", 200],
      ["category-transport", 50],
      ["category-uncategorized", 50],
    ]));
  });

  it("uses Uncategorized for unknown classifications and preserves the full inflow amount", () => {
    const result = buildRepaymentBudgetDistribution(300, [{ expenseId: "unknown", amount: 200 }], "category-uncategorized", categoryByExpense);
    expect(result.get("category-uncategorized")).toBe(300);
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(300);
  });

  it("rejects allocations greater than the canonical repayment amount", () => {
    expect(() => buildRepaymentBudgetDistribution(100, [{ expenseId: "expense-food", amount: 101 }], "category-uncategorized", categoryByExpense)).toThrow();
  });
});
