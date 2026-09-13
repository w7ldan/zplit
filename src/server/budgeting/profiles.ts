import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetPeriodCategories, budgetPeriods, budgetProfiles } from "@/db/schema";
import { canonicalBudgetCategoryName, normalizeBudgetCategoryName, validateBudgetCategoryNames } from "@/domain/budgeting/categories";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { databaseCode } from "@/server/database-error-code";
import { listBudgetCategoryOptions } from "./categories";

export type BudgetSetupInput = {
  periodName: string;
  startsOn: string;
  endsOn: string;
  totalBudget: number;
  categories: Array<{ name: string; allocatedAmount: number }>;
};

function validateSetup(input: BudgetSetupInput) {
  const periodName = input.periodName.trim();
  const categories = input.categories.map((category) => ({ name: canonicalBudgetCategoryName(category.name), allocatedAmount: category.allocatedAmount }));
  if (!periodName || periodName.length > 120 || !isValidBudgetDate(input.startsOn) || !isValidBudgetDate(input.endsOn) || input.startsOn > input.endsOn) {
    throw new BudgetError("INVALID_INPUT", "Enter a period name, a valid date range, and a total budget.");
  }
  if (!Number.isSafeInteger(input.totalBudget) || input.totalBudget < 1 || input.totalBudget > MAX_RUPIAH) {
    throw new BudgetError("INVALID_INPUT", "Total budget must be a whole Rupiah amount greater than zero.");
  }
  if (!categories.every((category) => category.name && Number.isSafeInteger(category.allocatedAmount) && category.allocatedAmount >= 0 && category.allocatedAmount <= MAX_RUPIAH)) {
    throw new BudgetError("INVALID_INPUT", "Category names and allocations must be valid whole Rupiah amounts.");
  }
  if (!validateBudgetCategoryNames(categories.map((category) => category.name))) {
    throw new BudgetError("INVALID_INPUT", "Category names must be unique, and Uncategorized is reserved.");
  }
  if (categories.reduce((sum, category) => sum + category.allocatedAmount, 0) > input.totalBudget) {
    throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "Category allocations cannot exceed the total budget.");
  }
  return { ...input, periodName, categories };
}

export async function getBudgetProfile(database: Database, ownerUserId: string) {
  const [profile] = await database.select().from(budgetProfiles).where(eq(budgetProfiles.ownerUserId, ownerUserId)).limit(1);
  return profile ?? null;
}

export type ExpenseBudgetControlOptions = {
  defaultIncluded: boolean;
  defaultCategoryId: string;
  categories: Array<{ id: string; name: string }>;
};

/**
 * The private preference plus the owner's usable categories for an eligible
 * expense create form. `undefined` means the owner has not configured
 * Budgeting.
 */
export async function getExpenseBudgetControl(database: Database, ownerUserId: string): Promise<ExpenseBudgetControlOptions | undefined> {
  const profile = await getBudgetProfile(database, ownerUserId);
  if (!profile) return undefined;
  const categories = await listBudgetCategoryOptions(database, ownerUserId);
  if (categories.length === 0) return undefined;
  return {
    defaultIncluded: profile.includeNewExpensesByDefault,
    defaultCategoryId: categories.find((category) => category.name === "Uncategorized")?.id ?? categories[0]!.id,
    categories,
  };
}

/**
 * The single private preference that seeds the creation-time Budget control.
 * It only affects forms rendered afterwards; existing sources keep their
 * recorded participation.
 */
export async function setBudgetIncludeNewExpensesByDefault(database: Database, ownerUserId: string, includeNewExpensesByDefault: boolean) {
  return database.transaction(async (transaction) => {
    const [profile] = await transaction
      .select({ ownerUserId: budgetProfiles.ownerUserId })
      .from(budgetProfiles)
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .limit(1)
      .for("update");
    if (!profile) throw new BudgetError("NOT_CONFIGURED", "Budgeting is not configured.");
    const [updated] = await transaction
      .update(budgetProfiles)
      .set({ includeNewExpensesByDefault, updatedAt: new Date() })
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .returning();
    if (!updated) throw new BudgetError("CONFLICT", "The Budget preference could not be saved.");
    return updated;
  });
}

export async function createBudgetSetup(database: Database, ownerUserId: string, input: BudgetSetupInput) {
  if (!ownerUserId.trim()) throw new BudgetError("INVALID_INPUT", "A budget owner is required.");
  const valid = validateSetup(input);
  return database.transaction(async (transaction) => {
    try {
      await transaction.insert(budgetProfiles).values({ ownerUserId }).returning({ ownerUserId: budgetProfiles.ownerUserId });
    } catch (error) {
      if (databaseCode(error, true) === "23505") throw new BudgetError("ALREADY_CONFIGURED", "Budgeting is already configured.");
      throw error;
    }

    const uncategorized = await transaction.insert(budgetCategories).values({
      ownerUserId,
      name: "Uncategorized",
      normalizedName: "uncategorized",
      systemKey: "uncategorized",
    }).returning({ id: budgetCategories.id });
    const uncategorizedId = uncategorized[0]?.id;
    if (!uncategorizedId) throw new BudgetError("CONFLICT", "Budget setup could not create its system category.");

    const customCategories = valid.categories.length
      ? await transaction.insert(budgetCategories).values(valid.categories.map((category) => ({
        ownerUserId,
        name: category.name,
        normalizedName: normalizeBudgetCategoryName(category.name),
      }))).returning({ id: budgetCategories.id, normalizedName: budgetCategories.normalizedName })
      : [];
    const customCategoryIds = new Map(customCategories.map((category) => [category.normalizedName, category.id]));
    const periodRows = await transaction.insert(budgetPeriods).values({
      ownerUserId,
      ordinal: 1,
      name: valid.periodName,
      startsOn: valid.startsOn,
      endsOn: valid.endsOn,
      totalBudget: valid.totalBudget,
      status: "active",
    }).returning();
    const period = periodRows[0];
    if (!period) throw new BudgetError("CONFLICT", "Budget setup could not create its first period.");
    await transaction.insert(budgetPeriodCategories).values([
      { ownerUserId, budgetPeriodId: period.id, budgetCategoryId: uncategorizedId, allocatedAmount: 0, displayOrder: 0 },
      ...valid.categories.map((category, index) => {
        const categoryId = customCategoryIds.get(normalizeBudgetCategoryName(category.name));
        if (!categoryId) throw new BudgetError("CONFLICT", "Budget setup could not create its custom categories.");
        return {
        ownerUserId,
        budgetPeriodId: period.id,
        budgetCategoryId: categoryId,
        allocatedAmount: category.allocatedAmount,
        displayOrder: index + 1,
        };
      }),
    ]);
    return { profile: { ownerUserId }, period };
  });
}
