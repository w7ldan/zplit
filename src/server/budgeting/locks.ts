import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetProfiles } from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";

export function assertBudgetOwner(ownerUserId: string) {
  if (!ownerUserId.trim()) throw new BudgetError("INVALID_INPUT", "A budget owner is required.");
}

export async function lockBudgetProfile(database: Database, ownerUserId: string) {
  assertBudgetOwner(ownerUserId);
  const [profile] = await database
    .select()
    .from(budgetProfiles)
    .where(eq(budgetProfiles.ownerUserId, ownerUserId))
    .limit(1)
    .for("update");
  if (!profile) throw new BudgetError("NOT_CONFIGURED", "Budgeting is not configured.");
  return profile;
}

export async function lockBudgetProfiles(database: Database, ownerUserIds: string[]) {
  const owners = [...new Set(ownerUserIds)].filter(Boolean).sort();
  if (owners.length === 0) return [];
  return database
    .select()
    .from(budgetProfiles)
    .where(inArray(budgetProfiles.ownerUserId, owners))
    .orderBy(asc(budgetProfiles.ownerUserId))
    .for("update");
}
