import { describe, expect, it } from "vitest";
import { ledgerStory } from "./public-scenario";

describe("illustrative public record", () => {
  it("keeps evidence, search, and scope tied to the source expense", () => {
    const expense = ledgerStory.expenses[0];
    expect(ledgerStory.receipt.items.reduce((sum, item) => sum + item.amount, 0)).toBe(expense.amount);
    expect(ledgerStory.groupExpense).toEqual({ title: expense.title, amount: expense.amount });
    expect(ledgerStory.searchRecords[0]).toMatchObject(expense);
    expect(ledgerStory.searchRecords[0].date).toBe(ledgerStory.date);
    expect(new Date("2026-05-16T12:00:00Z").getUTCDay()).toBe(6);
  });

  it("keeps the repayment allocated to Raka and Sari open", () => {
    const assigned = ledgerStory.personalShares.reduce((sum, person) => sum + person.amount, 0);
    expect(assigned - ledgerStory.repayment.amount).toBe(ledgerStory.personalBalance.amount);
    expect(ledgerStory.repayment.from).toBe(ledgerStory.personalShares[0].name);
    expect(ledgerStory.repayment.amount).toBe(ledgerStory.personalShares[0].amount);
    expect(ledgerStory.personalBalance.friend).toBe(ledgerStory.personalShares[1].name);
  });
});
