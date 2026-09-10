import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

vi.mock("server-only", () => ({}));

function builder(result: unknown[]) {
  const current: Record<string, ReturnType<typeof vi.fn> | ((resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => void)> = {};
  const chain = current as typeof current & { then: Promise<unknown>["then"] };
  for (const method of ["from", "innerJoin", "where", "limit", "orderBy", "groupBy"]) current[method] = vi.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function database(selectResults: unknown[][]) {
  const results = [...selectResults];
  return {
    select: vi.fn(() => builder(results.shift() ?? [])),
  } as unknown as Database & { select: ReturnType<typeof vi.fn> };
}

describe("Budget period history reporting", () => {
  it("unions planned and applied-impact categories while reconciling totals in three queries", async () => {
    const databaseInstance = database([
      [{ id: "period-1", ordinal: 1, name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", status: "closed", totalBudget: 1000 }],
      [
        { periodId: "period-1", categoryId: "uncategorized", categoryName: "Uncategorized", allocatedAmount: 0, displayOrder: 0 },
        { periodId: "period-1", categoryId: "food", categoryName: "Food", allocatedAmount: 50, displayOrder: 1 },
      ],
      [
        { periodId: "period-1", categoryId: "food", categoryName: "Food", direction: "outflow", amount: "100" },
        { periodId: "period-1", categoryId: "travel", categoryName: "Travel", direction: "outflow", amount: "50" },
        { periodId: "period-1", categoryId: "food", categoryName: "Food", direction: "inflow", amount: "25" },
      ],
    ]);

    const [period] = await (await import("./reporting")).listBudgetPeriodHistory(databaseInstance, "owner-1");

    expect(period).toMatchObject({ ordinal: 1, netSpent: 125, remaining: 875 });
    expect(period?.categories).toEqual([
      { id: "uncategorized", name: "Uncategorized", allocatedAmount: 0, outflowApplied: 0, inflowApplied: 0, netSpent: 0, remaining: 0 },
      { id: "food", name: "Food", allocatedAmount: 50, outflowApplied: 100, inflowApplied: 25, netSpent: 75, remaining: -25 },
      { id: "travel", name: "Travel", allocatedAmount: 0, outflowApplied: 50, inflowApplied: 0, netSpent: 50, remaining: -50 },
    ]);
    expect(period?.categories.filter((category) => category.id === "travel")).toHaveLength(1);
    expect(period?.categories.reduce((sum, category) => sum + category.netSpent, 0)).toBe(period?.netSpent);
    expect(databaseInstance.select).toHaveBeenCalledTimes(3);
  });
});
