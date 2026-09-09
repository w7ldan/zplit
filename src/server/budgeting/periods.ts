import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetImpacts, budgetPeriods, budgetPeriodCategories, budgetTransactions } from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { lockBudgetProfile } from "./locks";

export type BudgetPeriodUpdate = { name: string; startsOn: string; endsOn: string; totalBudget: number };

function isValidPeriodUpdate(input: BudgetPeriodUpdate, name: string) {
  return Boolean(name)
    && name.length <= 120
    && isValidBudgetDate(input.startsOn)
    && isValidBudgetDate(input.endsOn)
    && input.startsOn <= input.endsOn
    && Number.isSafeInteger(input.totalBudget)
    && input.totalBudget >= 1
    && input.totalBudget <= MAX_RUPIAH;
}

export async function getActiveBudgetPeriod(database: Database, ownerUserId: string) {
  const [period] = await database.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1);
  return period ?? null;
}

export async function updateActiveBudgetPeriod(database: Database, ownerUserId: string, input: BudgetPeriodUpdate) {
  const name = input.name.trim();
  if (!isValidPeriodUpdate(input, name)) {
    throw new BudgetError("INVALID_INPUT", "Enter a period name, a valid date range, and a total budget.");
  }
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    const [allocationTotal] = await transaction.select({ total: sql<string>`coalesce(sum(${budgetPeriodCategories.allocatedAmount}), 0)::text` }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id)));
    if (Number(allocationTotal?.total ?? 0) > input.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "The total budget cannot be lower than current category allocations.");
    if (input.startsOn !== period.startsOn || input.endsOn !== period.endsOn) {
      const [excludedTransaction] = await transaction
        .select({ id: budgetTransactions.id })
        .from(budgetTransactions)
        .innerJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id), eq(budgetImpacts.budgetPeriodId, period.id)))
        .where(and(
          eq(budgetTransactions.ownerUserId, ownerUserId),
          eq(budgetTransactions.status, "posted"),
          eq(budgetTransactions.origin, "manual"),
          or(lt(budgetTransactions.occurredOn, input.startsOn), gt(budgetTransactions.occurredOn, input.endsOn)),
        ))
        .limit(1);
      if (excludedTransaction) throw new BudgetError("CONFLICT", "The date range cannot exclude a posted budget transaction.");
    }
    const [updated] = await transaction.update(budgetPeriods).set({ name, startsOn: input.startsOn, endsOn: input.endsOn, totalBudget: input.totalBudget, updatedAt: new Date() }).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.id, period.id))).returning();
    return updated ?? period;
  });
}
