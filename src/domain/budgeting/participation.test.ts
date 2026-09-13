import { describe, expect, it } from "vitest";
import {
  EXPENSE_BUDGET_CATEGORY_FIELD,
  EXPENSE_BUDGET_INCLUDED_FIELD,
  EXPENSE_BUDGET_MARKER,
  EXPENSE_BUDGET_PARTICIPATION_FIELD,
  parseExpenseBudgetParticipation,
} from "./participation";

function budgetForm(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

const categoryId = "11111111-1111-4111-8111-111111111111";

describe("expense Budget participation parsing", () => {
  it("treats a form without the Budget control as an undecided source", () => {
    expect(parseExpenseBudgetParticipation(budgetForm({}))).toEqual({ ok: true, participation: undefined });
  });

  it("records an explicit exclusion when the control is unchecked", () => {
    const result = parseExpenseBudgetParticipation(budgetForm({
      [EXPENSE_BUDGET_PARTICIPATION_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_CATEGORY_FIELD]: categoryId,
    }));
    expect(result).toEqual({ ok: true, participation: { includeInBudget: false } });
  });

  it("accepts an included decision with and without a category", () => {
    expect(parseExpenseBudgetParticipation(budgetForm({
      [EXPENSE_BUDGET_PARTICIPATION_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_INCLUDED_FIELD]: EXPENSE_BUDGET_MARKER,
    }))).toEqual({ ok: true, participation: { includeInBudget: true, categoryId: null } });
    expect(parseExpenseBudgetParticipation(budgetForm({
      [EXPENSE_BUDGET_PARTICIPATION_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_INCLUDED_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_CATEGORY_FIELD]: categoryId.toUpperCase(),
    }))).toEqual({ ok: true, participation: { includeInBudget: true, categoryId } });
  });

  it("rejects a malformed included category instead of falling back", () => {
    expect(parseExpenseBudgetParticipation(budgetForm({
      [EXPENSE_BUDGET_PARTICIPATION_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_INCLUDED_FIELD]: EXPENSE_BUDGET_MARKER,
      [EXPENSE_BUDGET_CATEGORY_FIELD]: "not-a-category",
    }))).toEqual({ ok: false, categoryError: "Choose a valid Budget category." });
  });
});
