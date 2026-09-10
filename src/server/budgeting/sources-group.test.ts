import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildGroupSettlementBudgetDistribution } from "./sources-group";

describe("Group settlement budget distribution", () => {
  it("maps applications, aggregates categories, and credits the remainder", () => {
    expect(buildGroupSettlementBudgetDistribution(500, [
      { amount: 100, categoryId: "food" },
      { amount: 150, categoryId: "food" },
      { amount: 100, categoryId: "travel" },
    ], "uncategorized")).toEqual(new Map([
      ["food", 250],
      ["travel", 100],
      ["uncategorized", 150],
    ]));
  });

  it("uses Uncategorized for missing or unusable classifications", () => {
    const result = buildGroupSettlementBudgetDistribution(300, [
      { amount: 100, categoryId: null },
      { amount: 100, categoryId: "usable" },
    ], "uncategorized");
    expect(result).toEqual(new Map([["uncategorized", 200], ["usable", 100]]));
    expect([...result.values()].reduce((sum, amount) => sum + amount, 0)).toBe(300);
  });

  it("rejects canonical applications that exceed settlement cash", () => {
    expect(() => buildGroupSettlementBudgetDistribution(100, [{ amount: 101, categoryId: "food" }], "uncategorized")).toThrow();
  });
});
