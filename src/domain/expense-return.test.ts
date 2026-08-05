import { describe, expect, it } from "vitest";
import { addOutingToExpenseReturnTarget, validateExpenseReturnTarget } from "./expense-return";

describe("expense return targets", () => {
  it("accepts only the Expenses list route and preserves its query and fragment", () => {
    const target = "/app/expenses?q=Dinner&source=ledger#top";
    expect(validateExpenseReturnTarget(target)).toBe(target);
  });

  it("rejects external, public, nested, malformed, escaped, and oversized targets", () => {
    for (const target of [
      "https://evil.example/app/expenses",
      "//evil.example/app/expenses",
      "/app",
      "/app/outings",
      "/app/expenses/anything",
      "/app/expenses?next=%5C%5Cevil.example",
      "/app/expenses?next=%255c%255cevil.example",
      "/app/expenses?next=%0a",
      "/app/expenses?bad=%",
      `/app/expenses?x=${"a".repeat(2048)}`,
    ]) expect(validateExpenseReturnTarget(target)).toBeUndefined();
    expect(validateExpenseReturnTarget(null)).toBeUndefined();
  });

  it("sets create and the new outing without trusting prior outing values", () => {
    expect(addOutingToExpenseReturnTarget("/app/expenses?q=Dinner&outing=old&create=0#top", "outing-new"))
      .toBe("/app/expenses?q=Dinner&outing=outing-new&create=1#top");
  });
});
