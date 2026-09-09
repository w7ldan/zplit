import { describe, expect, it } from "vitest";
import { formatSignedRupiah, parseNonNegativeRupiah } from "./amounts";
import { canonicalBudgetCategoryName, normalizeBudgetCategoryName, validateBudgetCategoryNames } from "./categories";
import { calculateSafeDaily, inclusiveBudgetDays, isValidBudgetDate } from "./dates";
import { categoryNetSpent, netBudgetSpent, remainingBudget } from "./reporting";

describe("budgeting amounts", () => {
  it("accepts zero and supported Rupiah allocation formats", () => {
    expect(parseNonNegativeRupiah("0")).toBe(0);
    expect(parseNonNegativeRupiah("1")).toBe(1);
    expect(parseNonNegativeRupiah("100000")).toBe(100000);
    expect(parseNonNegativeRupiah("100.000")).toBe(100000);
    expect(parseNonNegativeRupiah("2.147.483.647")).toBe(2_147_483_647);
  });

  it("rejects malformed, negative, decimal, and over-limit allocations", () => {
    for (const value of ["", "-1", "1.00", "100,000", "10.00.000", "2.147.483.648"]) expect(parseNonNegativeRupiah(value)).toBeNull();
  });

  it("formats signed derived values without weakening canonical formatting", () => {
    expect(formatSignedRupiah(50_000)).toBe("Rp 50.000");
    expect(formatSignedRupiah(0)).toBe("Rp 0");
    expect(formatSignedRupiah(-50_000)).toBe("-Rp 50.000");
    expect(formatSignedRupiah(3_000_000_000)).toBe("Rp 3.000.000.000");
  });
});

describe("budgeting categories", () => {
  it("keeps visible capitalization while normalizing comparison whitespace and case", () => {
    expect(canonicalBudgetCategoryName("  Eating   Out ")).toBe("Eating Out");
    expect(normalizeBudgetCategoryName("  Eating   Out ")).toBe("eating out");
  });

  it("rejects duplicate normalized names and the system category collision", () => {
    expect(validateBudgetCategoryNames(["Food", "  FOOD "])).toBe(false);
    expect(validateBudgetCategoryNames(["Uncategorized"])).toBe(false);
    expect(validateBudgetCategoryNames(["Food", "Travel"])).toBe(true);
  });
});

describe("budgeting dates and reporting", () => {
  it("validates real Gregorian date-only values", () => {
    expect(isValidBudgetDate("2026-02-28")).toBe(true);
    expect(isValidBudgetDate("2026-02-29")).toBe(false);
    expect(isValidBudgetDate("2028-02-29")).toBe(true);
    expect(isValidBudgetDate("2026-02-30")).toBe(false);
    expect(isValidBudgetDate("2026-13-01")).toBe(false);
    expect(isValidBudgetDate("2026-00-01")).toBe(false);
    expect(isValidBudgetDate("2026-01-00")).toBe(false);
    expect(isValidBudgetDate("26-01-01")).toBe(false);
  });

  it("counts safe-daily days inclusively and preserves negative floor semantics", () => {
    expect(inclusiveBudgetDays("2026-09-01", "2026-09-30", "2026-09-01")).toBe(30);
    expect(inclusiveBudgetDays("2026-09-01", "2026-09-30", "2026-09-15")).toBe(16);
    expect(inclusiveBudgetDays("2026-09-01", "2026-09-30", "2026-09-30")).toBe(1);
    expect(inclusiveBudgetDays("2026-09-30", "2026-09-30", "2026-09-30")).toBe(1);
    expect(inclusiveBudgetDays("2026-09-01", "2026-09-30", "2026-08-20")).toBe(30);
    expect(inclusiveBudgetDays("2026-09-01", "2026-09-30", "2026-10-01")).toBe(0);
    expect(calculateSafeDaily("2026-09-01", "2026-09-30", "2026-09-28", 1000)).toBe(333);
    expect(calculateSafeDaily("2026-09-01", "2026-09-30", "2026-09-28", -1000)).toBe(-334);
    expect(calculateSafeDaily("2026-09-01", "2026-09-30", "2026-10-01", 1000)).toBeNull();
  });

  it("keeps budget reporting signed and unclamped", () => {
    expect(netBudgetSpent(100_000, 150_000)).toBe(-50_000);
    expect(remainingBudget(1_000_000, -50_000)).toBe(1_050_000);
    expect(categoryNetSpent(1_100_000, 0)).toBe(1_100_000);
  });
});
