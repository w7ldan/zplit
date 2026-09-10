import { describe, expect, it } from "vitest";
import { isValidBudgetDate } from "./dates";
import { buildRecurringCandidates, resolveRecurringOccurrenceCategory, scheduledRecurringDates } from "./recurrence";

describe("budget recurring schedule math", () => {
  describe("every budget period", () => {
    const frequency = "every_budget_period" as const;

    it("uses the period start when the template started earlier", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-08-15" }, { startsOn: "2026-09-01", endsOn: "2026-09-30" })).toEqual(["2026-09-01"]);
    });

    it("uses starts_on inside the first eligible period", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-09-10" }, { startsOn: "2026-09-01", endsOn: "2026-09-30" })).toEqual(["2026-09-10"]);
    });

    it("uses the future period start", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-09-10" }, { startsOn: "2026-10-01", endsOn: "2026-10-31" })).toEqual(["2026-10-01"]);
    });

    it("produces nothing for a period entirely before starts_on", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-10-01" }, { startsOn: "2026-09-01", endsOn: "2026-09-30" })).toEqual([]);
    });
  });

  describe("monthly", () => {
    const frequency = "monthly" as const;

    it("uses the anchor day for ordinary months", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-01-15" }, { startsOn: "2026-01-01", endsOn: "2026-03-31" })).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
    });

    it("clamps day 31 to each short month without carrying the clamp forward", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-01-31" }, { startsOn: "2026-01-01", endsOn: "2026-04-30" })).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    });

    it("uses the leap-day February and returns to day 31 in March", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2028-01-31" }, { startsOn: "2028-01-01", endsOn: "2028-03-31" })).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    });

    it("supports multiple monthly dates inside one long period", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-01-05" }, { startsOn: "2026-01-01", endsOn: "2026-04-30" })).toEqual(["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"]);
    });

    it("produces no dates for a short period between anchors", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-01-15" }, { startsOn: "2026-02-01", endsOn: "2026-02-10" })).toEqual([]);
    });

    it("never produces a date before starts_on", () => {
      expect(scheduledRecurringDates({ frequency, startsOn: "2026-09-20" }, { startsOn: "2026-09-01", endsOn: "2026-11-30" })).toEqual(["2026-09-20", "2026-10-20", "2026-11-20"]);
    });

    it("is deterministic, chronological, unique, and returns real DATE values inside the period", () => {
      const period = { startsOn: "2028-01-15", endsOn: "2028-04-14" };
      const first = scheduledRecurringDates({ frequency, startsOn: "2028-01-31" }, period);
      const second = scheduledRecurringDates({ frequency, startsOn: "2028-01-31" }, period);
      expect(first).toEqual(second);
      expect(first).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
      expect(new Set(first).size).toBe(first.length);
      expect([...first].sort()).toEqual(first);
      for (const value of first) {
        expect(isValidBudgetDate(value)).toBe(true);
        expect(value >= period.startsOn && value <= period.endsOn).toBe(true);
      }
    });
  });

  it("builds deterministic candidates ordered by date, name, and identity", () => {
    const candidates = buildRecurringCandidates([
      { id: "template-b", name: "Gym", amount: 300_000, categoryId: "category-food", frequency: "monthly", startsOn: "2026-01-31", spreadCount: 1 },
      { id: "template-a", name: "Rent", amount: 1_200_000, categoryId: "category-travel", frequency: "every_budget_period", startsOn: "2026-01-01", spreadCount: 3 },
    ], { startsOn: "2026-01-01", endsOn: "2026-02-28" });
    expect(candidates.map((candidate) => [candidate.name, candidate.scheduledOn])).toEqual([
      ["Rent", "2026-01-01"],
      ["Gym", "2026-01-31"],
      ["Gym", "2026-02-28"],
    ]);
  });

  it("maps an unavailable template category to Uncategorized", () => {
    expect(resolveRecurringOccurrenceCategory("category-food", new Set(["category-food"]), "category-uncategorized")).toBe("category-food");
    expect(resolveRecurringOccurrenceCategory("category-food", new Set(["category-uncategorized"]), "category-uncategorized")).toBe("category-uncategorized");
  });
});
