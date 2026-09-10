import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";

vi.mock("server-only", () => ({}));

function builder(result: unknown[], conditionArgs?: unknown[]) {
  const current: Record<string, ReturnType<typeof vi.fn> | ((resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => void)> = {};
  const chain = current as typeof current & { then: Promise<unknown>["then"] };
  for (const method of ["from", "limit", "orderBy", "groupBy"]) current[method] = vi.fn(() => chain);
  current.innerJoin = vi.fn((...args: unknown[]) => {
    conditionArgs?.push(args.at(-1));
    return chain;
  });
  current.where = vi.fn((condition?: unknown) => {
    conditionArgs?.push(condition);
    return chain;
  });
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function database(selectResults: unknown[][]) {
  const results = [...selectResults];
  return {
    select: vi.fn(() => builder(results.shift() ?? [])),
  } as unknown as Database & { select: ReturnType<typeof vi.fn> };
}

function recordingDatabase(selectResults: unknown[][]) {
  const results = [...selectResults];
  const conditionArgs: unknown[] = [];
  const select = vi.fn(() => builder(results.shift() ?? [], conditionArgs));
  return { database: { select } as unknown as Database, select, conditionArgs };
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

describe("Budget Overview snapshot reporting", () => {
  it("skips Budget state entirely when no profile exists", async () => {
    const { database: databaseInstance, select } = recordingDatabase([[]]);

    await expect((await import("./reporting")).getBudgetOverviewSnapshot(databaseInstance, "owner-1")).resolves.toEqual({ configured: false });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("reports a configured profile without an active period instead of fabricated totals", async () => {
    const { database: databaseInstance, select } = recordingDatabase([[{ ownerUserId: "owner-1" }], []]);

    await expect((await import("./reporting")).getBudgetOverviewSnapshot(databaseInstance, "owner-1")).resolves.toEqual({ configured: true, period: null });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("derives Remaining and Net spent from applied posted impacts and keeps recurring planning separate", async () => {
    const { database: databaseInstance, select, conditionArgs } = recordingDatabase([
      [{ ownerUserId: "owner-1" }],
      [{ id: "period-1", ordinal: 1, name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 1_000 }],
      [{ direction: "outflow", amount: "250" }, { direction: "inflow", amount: "50" }],
      [{ dueCount: "2", expectedAmount: "300", nextDueOn: "2026-10-01" }],
    ]);

    const snapshot = await (await import("./reporting")).getBudgetOverviewSnapshot(databaseInstance, "owner-1");

    expect(snapshot).toMatchObject({
      configured: true,
      period: { id: "period-1", name: "September", netSpent: 200, remaining: 800 },
      recurring: { dueCount: 2, expectedAmount: 300 },
    });
    expect(select).toHaveBeenCalledTimes(4);
    const params = conditionArgs.flatMap((condition) => new PgDialect().sqlToQuery(condition as SQL).params);
    expect(params).toContain("applied");
    expect(params).toContain("posted");
    expect(params).toContain("owner-1");
  });
});
