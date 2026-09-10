import { describe, expect, it } from "vitest";
import { formatSignedRupiah, parseNonNegativeRupiah } from "./amounts";
import { canonicalBudgetCategoryName, normalizeBudgetCategoryName, validateBudgetCategoryNames } from "./categories";
import { calculateSafeDaily, inclusiveBudgetDays, isValidBudgetDate, localCalendarDate } from "./dates";
import { categoryNetSpent, netBudgetSpent, remainingBudget } from "./reporting";
import { splitBudgetAmount } from "./spread";
import { summarizeBudgetCategories } from "./types";

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
  it("bounds compact repayment category summaries deterministically", () => {
    expect(summarizeBudgetCategories([])).toBe("Not absorbed");
    expect(summarizeBudgetCategories(["Food"])).toBe("Food");
    expect(summarizeBudgetCategories(["Food", "Transport"])).toBe("Food + Transport");
    expect(summarizeBudgetCategories(["Food", "Transport", "Dining"])).toBe("Multiple categories");
  });

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

  it("derives the browser-local calendar date across a UTC date boundary", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Jakarta";
    try {
      const instant = new Date("2026-09-10T17:30:00Z");
      expect(instant.toISOString().slice(0, 10)).toBe("2026-09-10");
      expect(localCalendarDate(instant)).toBe("2026-09-11");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("keeps budget reporting signed and unclamped", () => {
    expect(netBudgetSpent(100_000, 150_000)).toBe(-50_000);
    expect(remainingBudget(1_000_000, -50_000)).toBe(1_050_000);
    expect(categoryNetSpent(1_100_000, 0)).toBe(1_100_000);
  });
});

describe("budget spread math", () => {
  it("splits evenly and keeps one real amount across the requested periods", () => {
    expect(splitBudgetAmount(1_200_000, 12)).toEqual(Array(12).fill(100_000));
  });

  it("gives the remainder to the earliest periods", () => {
    expect(splitBudgetAmount(1_000, 3)).toEqual([334, 333, 333]);
  });

  it("supports one and twenty-four periods", () => {
    expect(splitBudgetAmount(100, 1)).toEqual([100]);
    expect(splitBudgetAmount(24, 24)).toEqual(Array(24).fill(1));
  });

  it("rejects invalid amounts and counts", () => {
    expect(() => splitBudgetAmount(2, 3)).toThrow();
    expect(() => splitBudgetAmount(100, 0)).toThrow();
    expect(() => splitBudgetAmount(100, 25)).toThrow();
    expect(splitBudgetAmount(997, 24).reduce((sum, part) => sum + part, 0)).toBe(997);
  });
});
