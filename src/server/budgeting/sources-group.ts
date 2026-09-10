import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  budgetCategories,
  budgetGroupExpenseSources,
  budgetGroupObligationClassifications,
  budgetGroupSettlementSources,
  budgetImpacts,
  budgetPeriods,
  budgetTransactions,
  groupExpenses,
  groupObligations,
  groupSettlementApplications,
  groupSettlements,
  groupParticipants,
  groups,
} from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";
import { splitBudgetAmount } from "@/domain/budgeting/spread";
import { LedgerIntegrityError } from "@/domain/ledger-summary";
import type { LedgerTransaction } from "@/domain/ledger/mutation-hooks";
import { loadAvailableGroupObligationsForParticipants } from "@/server/group-obligation-applications";
import { loadParticipantMap } from "@/server/group-participant-presentation";
import { lockBudgetProfiles, lockBudgetProfile } from "./locks";

type ActivePeriod = typeof budgetPeriods.$inferSelect;
type BudgetTransactionRecord = typeof budgetTransactions.$inferSelect;

export type GroupBudgetObligation = {
  id: string;
  groupId: string;
  groupName: string;
  description: string;
  amount: number;
  categoryId: string | null;
  categoryName: string;
};

export type GroupBudgetSharedMoney = {
  expectedBack: number;
  stillOwe: number;
  obligations: GroupBudgetObligation[];
};

type GroupSettlementApplicationRow = {
  appliedAmount: number;
  obligationId: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  sourceExpenseId: string;
};

function isInside(period: ActivePeriod, date: string) {
  return date >= period.startsOn && date <= period.endsOn;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function addAmount(target: Map<string, number>, categoryId: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerIntegrityError("Group budget source amount is invalid.");
  const next = (target.get(categoryId) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) throw new LedgerIntegrityError("Group budget source amount is unsafe.");
  target.set(categoryId, next);
}

export function buildGroupSettlementBudgetDistribution(
  amount: number,
  applications: readonly { amount: number; categoryId: string | null }[],
  uncategorizedId: string,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerIntegrityError("Group settlement amount is invalid.");
  let allocatedAmount = 0;
  const distribution = new Map<string, number>();
  for (const application of applications) {
    if (!Number.isSafeInteger(application.amount) || application.amount <= 0) throw new LedgerIntegrityError("Group settlement application amount is invalid.");
    allocatedAmount += application.amount;
    if (!Number.isSafeInteger(allocatedAmount) || allocatedAmount > amount) throw new LedgerIntegrityError("Group settlement applications exceed the source amount.");
    addAmount(distribution, application.categoryId ?? uncategorizedId, application.amount);
  }
  if (amount - allocatedAmount > 0) addAmount(distribution, uncategorizedId, amount - allocatedAmount);
  const total = [...distribution.values()].reduce((sum, value) => sum + value, 0);
  if (total !== amount) throw new LedgerIntegrityError("Group settlement budget impacts do not reconcile.");
  return distribution;
}

async function getUncategorizedId(transaction: LedgerTransaction, ownerUserId: string) {
  const [category] = await transaction
    .select({ id: budgetCategories.id })
    .from(budgetCategories)
    .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.systemKey, "uncategorized")))
    .limit(1);
  if (!category) throw new BudgetError("CONFLICT", "The budget system category is unavailable.");
  return category.id;
}

async function activePeriod(transaction: LedgerTransaction, ownerUserId: string) {
  const [period] = await transaction
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active")))
    .limit(1)
    .for("update");
  return period ?? null;
}

async function lockImpacts(transaction: LedgerTransaction, ownerUserId: string, transactionId: string) {
  return transaction
    .select()
    .from(budgetImpacts)
    .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, transactionId)))
    .orderBy(asc(budgetImpacts.targetPeriodOrdinal), asc(budgetImpacts.id))
    .for("update");
}

async function groupExpenseLink(transaction: LedgerTransaction, ownerUserId: string, groupExpenseId: string) {
  const [link] = await transaction
    .select({ link: budgetGroupExpenseSources, transaction: budgetTransactions })
    .from(budgetGroupExpenseSources)
    .innerJoin(budgetTransactions, and(
      eq(budgetTransactions.ownerUserId, ownerUserId),
      eq(budgetTransactions.id, budgetGroupExpenseSources.budgetTransactionId),
    ))
    .where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetGroupExpenseSources.groupExpenseId, groupExpenseId)))
    .limit(1);
  return link ?? null;
}

async function groupSettlementLink(transaction: LedgerTransaction, ownerUserId: string, groupSettlementId: string) {
  const [link] = await transaction
    .select({ link: budgetGroupSettlementSources, transaction: budgetTransactions })
    .from(budgetGroupSettlementSources)
    .innerJoin(budgetTransactions, and(
      eq(budgetTransactions.ownerUserId, ownerUserId),
      eq(budgetTransactions.id, budgetGroupSettlementSources.budgetTransactionId),
    ))
    .where(and(eq(budgetGroupSettlementSources.ownerUserId, ownerUserId), eq(budgetGroupSettlementSources.groupSettlementId, groupSettlementId)))
    .limit(1);
  return link ?? null;
}

async function createOrSyncTransaction(
  transaction: LedgerTransaction,
  ownerUserId: string,
  input: { direction: "outflow" | "inflow"; amount: number; description: string; occurredOn: string },
  link: { transaction: BudgetTransactionRecord } | null,
) {
  if (link) {
    const [updated] = await transaction
      .update(budgetTransactions)
      .set({ ...input, status: "posted", origin: "linked", voidedAt: null, updatedAt: new Date() })
      .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, link.transaction.id)))
      .returning();
    if (!updated) throw new BudgetError("CONFLICT", "The linked Group budget transaction is unavailable.");
    return updated;
  }
  const [created] = await transaction
    .insert(budgetTransactions)
    .values({ ownerUserId, ...input, status: "posted", origin: "linked" })
    .returning();
  if (!created) throw new BudgetError("CONFLICT", "The linked Group budget transaction could not be created.");
  return created;
}

async function createGroupExpenseLink(transaction: LedgerTransaction, ownerUserId: string, groupExpenseId: string, transactionId: string) {
  const [created] = await transaction
    .insert(budgetGroupExpenseSources)
    .values({ ownerUserId, budgetTransactionId: transactionId, groupExpenseId })
    .onConflictDoNothing({ target: [budgetGroupExpenseSources.ownerUserId, budgetGroupExpenseSources.groupExpenseId] })
    .returning();
  if (created) return created;
  const [existing] = await transaction
    .select()
    .from(budgetGroupExpenseSources)
    .where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetGroupExpenseSources.groupExpenseId, groupExpenseId)))
    .limit(1);
  if (!existing) throw new BudgetError("CONFLICT", "The linked Group Expense source could not be created.");
  if (existing.budgetTransactionId !== transactionId) {
    await transaction.delete(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId)));
  }
  return existing;
}

async function createGroupSettlementLink(transaction: LedgerTransaction, ownerUserId: string, groupSettlementId: string, transactionId: string) {
  const [created] = await transaction
    .insert(budgetGroupSettlementSources)
    .values({ ownerUserId, budgetTransactionId: transactionId, groupSettlementId })
    .onConflictDoNothing({ target: [budgetGroupSettlementSources.ownerUserId, budgetGroupSettlementSources.groupSettlementId] })
    .returning();
  if (created) return created;
  const [existing] = await transaction
    .select()
    .from(budgetGroupSettlementSources)
    .where(and(eq(budgetGroupSettlementSources.ownerUserId, ownerUserId), eq(budgetGroupSettlementSources.groupSettlementId, groupSettlementId)))
    .limit(1);
  if (!existing) throw new BudgetError("CONFLICT", "The linked Group settlement source could not be created.");
  if (existing.budgetTransactionId !== transactionId) {
    await transaction.delete(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId)));
  }
  return existing;
}

async function voidTransaction(transaction: LedgerTransaction, ownerUserId: string, transactionId: string) {
  await transaction
    .update(budgetTransactions)
    .set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId), eq(budgetTransactions.status, "posted")));
}

async function groupExpenseSource(transaction: LedgerTransaction, groupExpenseId: string) {
  const [expense] = await transaction
    .select({
      id: groupExpenses.id,
      payerParticipantId: groupExpenses.payerParticipantId,
      description: groupExpenses.description,
      totalAmount: groupExpenses.totalAmount,
      occurredOn: groupExpenses.occurredOn,
      state: groupExpenses.state,
      payerUserId: groupParticipants.userId,
    })
    .from(groupExpenses)
    .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupExpenses.groupId), eq(groupParticipants.id, groupExpenses.payerParticipantId)))
    .where(eq(groupExpenses.id, groupExpenseId))
    .limit(1);
  return expense ?? null;
}

async function groupSettlementSource(transaction: LedgerTransaction, groupSettlementId: string) {
  const [settlement] = await transaction.select().from(groupSettlements).where(eq(groupSettlements.id, groupSettlementId)).limit(1);
  if (!settlement) return null;
  const participants = await loadParticipantMap(transaction as Database, settlement.groupId, [settlement.senderParticipantId, settlement.recipientParticipantId]);
  return {
    ...settlement,
    sender: participants.get(settlement.senderParticipantId) ?? null,
    recipient: participants.get(settlement.recipientParticipantId) ?? null,
  };
}

async function reconcileGroupExpenseForOwner(transaction: LedgerTransaction, ownerUserId: string, expenseId: string, period: ActivePeriod | null) {
  const expense = await groupExpenseSource(transaction, expenseId);
  if (!expense || expense.payerUserId !== ownerUserId) return;
  const existing = await groupExpenseLink(transaction, ownerUserId, expenseId);
  if (expense.state !== "confirmed" || !expense.occurredOn) {
    if (existing?.transaction.status === "posted") await voidTransaction(transaction, ownerUserId, existing.transaction.id);
    return;
  }
  const created = await createOrSyncTransaction(transaction, ownerUserId, {
    direction: "outflow",
    amount: expense.totalAmount,
    description: expense.description,
    occurredOn: expense.occurredOn,
  }, existing);
  const linkedTransaction = await linkedExpenseTransaction(transaction, ownerUserId, expenseId, created, existing);
  const impacts = await lockImpacts(transaction, ownerUserId, linkedTransaction.id);
  if (impacts.length === 0 && period && isInside(period, expense.occurredOn)) {
    const uncategorizedId = await getUncategorizedId(transaction, ownerUserId);
    await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: linkedTransaction.id, budgetCategoryId: uncategorizedId, budgetPeriodId: period.id, amount: expense.totalAmount, status: "applied", targetPeriodOrdinal: period.ordinal });
  } else if (impacts.length === 1) {
    await transaction.update(budgetImpacts).set({ amount: expense.totalAmount, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, impacts[0]!.id)));
  } else if (impacts.length > 1) {
    const categoryId = impacts[0]!.budgetCategoryId;
    if (impacts.some((impact) => impact.budgetCategoryId !== categoryId)) throw new LedgerIntegrityError("A spread Group expense has inconsistent Budget categories.");
    let amounts: number[];
    try {
      amounts = splitBudgetAmount(expense.totalAmount, impacts.length);
    } catch {
      throw new LedgerIntegrityError("A spread Group expense cannot be distributed into positive impacts.");
    }
    for (const [index, impact] of impacts.entries()) {
      await transaction.update(budgetImpacts).set({ amount: amounts[index], updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, impact.id)));
    }
  }
}

async function settlementApplications(transaction: LedgerTransaction, settlementId: string): Promise<GroupSettlementApplicationRow[]> {
  return transaction
    .select({
      appliedAmount: groupSettlementApplications.appliedAmount,
      obligationId: groupSettlementApplications.obligationId,
      debtorParticipantId: groupObligations.debtorParticipantId,
      creditorParticipantId: groupObligations.creditorParticipantId,
      sourceExpenseId: groupObligations.sourceExpenseId,
    })
    .from(groupSettlementApplications)
    .innerJoin(groupObligations, and(eq(groupObligations.groupId, groupSettlementApplications.groupId), eq(groupObligations.id, groupSettlementApplications.obligationId)))
    .where(eq(groupSettlementApplications.settlementId, settlementId))
    .orderBy(asc(groupSettlementApplications.id));
}

async function senderCategories(transaction: LedgerTransaction, ownerUserId: string, obligationIds: string[]) {
  if (obligationIds.length === 0) return new Map<string, string>();
  const rows = await transaction
    .select({ obligationId: budgetGroupObligationClassifications.groupObligationId, categoryId: budgetGroupObligationClassifications.budgetCategoryId })
    .from(budgetGroupObligationClassifications)
    .innerJoin(groupObligations, eq(groupObligations.id, budgetGroupObligationClassifications.groupObligationId))
    .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupObligations.groupId), eq(groupParticipants.id, groupObligations.debtorParticipantId), eq(groupParticipants.userId, ownerUserId)))
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetGroupObligationClassifications.budgetCategoryId), isNull(budgetCategories.archivedAt)))
    .where(and(eq(budgetGroupObligationClassifications.ownerUserId, ownerUserId), inArray(budgetGroupObligationClassifications.groupObligationId, obligationIds)));
  return new Map(rows.map((row) => [row.obligationId, row.categoryId]));
}

async function recipientCategories(transaction: LedgerTransaction, ownerUserId: string, expenseIds: string[]) {
  if (expenseIds.length === 0) return new Map<string, string>();
  const rows = await transaction
    .select({ expenseId: budgetGroupExpenseSources.groupExpenseId, categoryId: budgetImpacts.budgetCategoryId, archivedAt: budgetCategories.archivedAt })
    .from(budgetGroupExpenseSources)
    .innerJoin(groupExpenses, eq(groupExpenses.id, budgetGroupExpenseSources.groupExpenseId))
    .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupExpenses.groupId), eq(groupParticipants.id, groupExpenses.payerParticipantId), eq(groupParticipants.userId, ownerUserId)))
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetGroupExpenseSources.budgetTransactionId), eq(budgetTransactions.status, "posted")))
    .innerJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id)))
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
    .where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), inArray(budgetGroupExpenseSources.groupExpenseId, expenseIds)))
    .orderBy(asc(budgetImpacts.id));
  const categories = new Map<string, string>();
  const seenCategories = new Map<string, string>();
  for (const row of rows) {
    const seen = seenCategories.get(row.expenseId);
    if (seen && seen !== row.categoryId) throw new LedgerIntegrityError("A Group expense has inconsistent spread Budget categories.");
    seenCategories.set(row.expenseId, row.categoryId);
    if (!row.archivedAt) categories.set(row.expenseId, row.categoryId);
  }
  return categories;
}

async function settlementDistribution(transaction: LedgerTransaction, ownerUserId: string, settlement: Awaited<ReturnType<typeof groupSettlementSource>>, direction: "outflow" | "inflow") {
  const uncategorizedId = await getUncategorizedId(transaction, ownerUserId);
  const applications = await settlementApplications(transaction, settlement!.id);
  const relevant = direction === "outflow"
    ? applications.filter((application) => application.debtorParticipantId === settlement!.senderParticipantId)
    : applications.filter((application) => application.creditorParticipantId === settlement!.recipientParticipantId);
  if (direction === "outflow") {
    const categories = await senderCategories(transaction, ownerUserId, uniqueIds(relevant.map((application) => application.obligationId)));
    return buildGroupSettlementBudgetDistribution(settlement!.amount, relevant.map((application) => ({ amount: application.appliedAmount, categoryId: categories.get(application.obligationId) ?? null })), uncategorizedId);
  }
  const categories = await recipientCategories(transaction, ownerUserId, uniqueIds(relevant.map((application) => application.sourceExpenseId)));
  return buildGroupSettlementBudgetDistribution(settlement!.amount, relevant.map((application) => ({ amount: application.appliedAmount, categoryId: categories.get(application.sourceExpenseId) ?? null })), uncategorizedId);
}

function settlementOwnerSide(settlement: NonNullable<Awaited<ReturnType<typeof groupSettlementSource>>>, ownerUserId: string) {
  if (settlement.sender?.userId === ownerUserId) return { direction: "outflow" as const, counterparty: settlement.recipient };
  if (settlement.recipient?.userId === ownerUserId) return { direction: "inflow" as const, counterparty: settlement.sender };
  return null;
}

export function settlementDescription(direction: "outflow" | "inflow", counterparty: { displayName: string | null } | null) {
  const name = counterparty?.displayName ?? "Group participant";
  return direction === "outflow" ? `Group payment to ${name}` : `Group payment from ${name}`;
}

async function linkedSettlementTransaction(transaction: LedgerTransaction, ownerUserId: string, settlementId: string, created: BudgetTransactionRecord, existing: Awaited<ReturnType<typeof groupSettlementLink>>) {
  if (existing) return created;
  const link = await createGroupSettlementLink(transaction, ownerUserId, settlementId, created.id);
  if (link.budgetTransactionId === created.id) return created;
  return (await groupSettlementLink(transaction, ownerUserId, settlementId))?.transaction ?? created;
}

async function linkedExpenseTransaction(transaction: LedgerTransaction, ownerUserId: string, expenseId: string, created: BudgetTransactionRecord, existing: Awaited<ReturnType<typeof groupExpenseLink>>) {
  if (existing) return created;
  const link = await createGroupExpenseLink(transaction, ownerUserId, expenseId, created.id);
  if (link.budgetTransactionId === created.id) return created;
  return (await groupExpenseLink(transaction, ownerUserId, expenseId))?.transaction ?? created;
}

async function writeSettlementImpacts(transaction: LedgerTransaction, ownerUserId: string, linkedTransaction: BudgetTransactionRecord, impacts: Awaited<ReturnType<typeof lockImpacts>>, settlement: NonNullable<Awaited<ReturnType<typeof groupSettlementSource>>>, direction: "outflow" | "inflow", period: ActivePeriod | null) {
  const distribution = await settlementDistribution(transaction, ownerUserId, settlement, direction);
  const assignedPeriodId = impacts[0]?.budgetPeriodId ?? period?.id;
  const assignedOrdinal = impacts[0]?.targetPeriodOrdinal ?? period?.ordinal;
  if (!assignedPeriodId || !assignedOrdinal) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
  if (impacts.length > 0) await transaction.delete(budgetImpacts).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, linkedTransaction.id)));
  for (const [categoryId, impactAmount] of distribution) {
    await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: linkedTransaction.id, budgetCategoryId: categoryId, budgetPeriodId: assignedPeriodId, amount: impactAmount, status: "applied", targetPeriodOrdinal: assignedOrdinal });
  }
}

async function reconcileGroupSettlementForOwner(transaction: LedgerTransaction, ownerUserId: string, settlementId: string, period: ActivePeriod | null) {
  const settlement = await groupSettlementSource(transaction, settlementId);
  if (!settlement) return;
  const side = settlementOwnerSide(settlement, ownerUserId);
  const existing = await groupSettlementLink(transaction, ownerUserId, settlementId);
  if (!side || settlement.state !== "confirmed" || !settlement.paidOn) {
    if (existing?.transaction.status === "posted") await voidTransaction(transaction, ownerUserId, existing.transaction.id);
    return;
  }
  const created = await createOrSyncTransaction(transaction, ownerUserId, { direction: side.direction, amount: settlement.amount, description: settlementDescription(side.direction, side.counterparty), occurredOn: settlement.paidOn }, existing);
  const linkedTransaction = await linkedSettlementTransaction(transaction, ownerUserId, settlementId, created, existing);
  const impacts = await lockImpacts(transaction, ownerUserId, linkedTransaction.id);
  if (impacts.length === 0 && (!period || !isInside(period, settlement.paidOn))) return;
  await writeSettlementImpacts(transaction, ownerUserId, linkedTransaction, impacts, settlement, side.direction, period);
}

async function profilePeriods(transaction: LedgerTransaction, ownerUserIds: string[]) {
  const profiles = await lockBudgetProfiles(transaction as Database, ownerUserIds);
  const periods = new Map<string, ActivePeriod | null>();
  for (const profile of profiles) periods.set(profile.ownerUserId, await activePeriod(transaction, profile.ownerUserId));
  return periods;
}

export async function reconcileGroupExpense(transaction: LedgerTransaction, expenseId: string) {
  const expense = await groupExpenseSource(transaction, expenseId);
  if (!expense?.payerUserId) return;
  const periods = await profilePeriods(transaction, [expense.payerUserId]);
  if (periods.has(expense.payerUserId)) await reconcileGroupExpenseForOwner(transaction, expense.payerUserId, expenseId, periods.get(expense.payerUserId) ?? null);
}

export async function reconcileGroupSettlement(transaction: LedgerTransaction, settlementId: string, ownerFilter?: string[]) {
  const settlement = await groupSettlementSource(transaction, settlementId);
  if (!settlement) return;
  const owners = [settlement.sender?.userId, settlement.recipient?.userId].filter((owner): owner is string => Boolean(owner));
  const selectedOwners = ownerFilter ? owners.filter((owner) => ownerFilter.includes(owner)) : owners;
  const periods = await profilePeriods(transaction, selectedOwners);
  for (const owner of [...periods.keys()].sort()) await reconcileGroupSettlementForOwner(transaction, owner, settlementId, periods.get(owner) ?? null);
}

export async function hasImportableGroupActivity(database: Database, ownerUserId: string, period: Pick<ActivePeriod, "startsOn" | "endsOn">) {
  const [expensesCount, senderCount, recipientCount] = await Promise.all([
    database.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(groupExpenses)
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupExpenses.groupId), eq(groupParticipants.id, groupExpenses.payerParticipantId), eq(groupParticipants.userId, ownerUserId)))
      .where(and(eq(groupExpenses.state, "confirmed"), gte(groupExpenses.occurredOn, period.startsOn), lte(groupExpenses.occurredOn, period.endsOn), sql`not exists (select 1 from ${budgetGroupExpenseSources} source where source.owner_user_id = ${ownerUserId} and source.group_expense_id = ${groupExpenses.id})`)),
    database.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(groupSettlements)
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupSettlements.groupId), eq(groupParticipants.id, groupSettlements.senderParticipantId), eq(groupParticipants.userId, ownerUserId)))
      .where(and(eq(groupSettlements.state, "confirmed"), gte(groupSettlements.paidOn, period.startsOn), lte(groupSettlements.paidOn, period.endsOn), sql`not exists (select 1 from ${budgetGroupSettlementSources} source where source.owner_user_id = ${ownerUserId} and source.group_settlement_id = ${groupSettlements.id})`)),
    database.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(groupSettlements)
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupSettlements.groupId), eq(groupParticipants.id, groupSettlements.recipientParticipantId), eq(groupParticipants.userId, ownerUserId)))
      .where(and(eq(groupSettlements.state, "confirmed"), gte(groupSettlements.paidOn, period.startsOn), lte(groupSettlements.paidOn, period.endsOn), sql`not exists (select 1 from ${budgetGroupSettlementSources} source where source.owner_user_id = ${ownerUserId} and source.group_settlement_id = ${groupSettlements.id})`)),
  ]);
  return Number(expensesCount[0]?.count ?? 0) + Number(senderCount[0]?.count ?? 0) + Number(recipientCount[0]?.count ?? 0) > 0;
}

export async function importGroupActivity(transaction: LedgerTransaction, ownerUserId: string, period: Pick<ActivePeriod, "startsOn" | "endsOn">) {
  const expenseRows = await transaction.select({ id: groupExpenses.id }).from(groupExpenses)
    .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupExpenses.groupId), eq(groupParticipants.id, groupExpenses.payerParticipantId), eq(groupParticipants.userId, ownerUserId)))
    .where(and(eq(groupExpenses.state, "confirmed"), gte(groupExpenses.occurredOn, period.startsOn), lte(groupExpenses.occurredOn, period.endsOn), sql`not exists (select 1 from ${budgetGroupExpenseSources} source where source.owner_user_id = ${ownerUserId} and source.group_expense_id = ${groupExpenses.id})`))
    .orderBy(asc(groupExpenses.occurredOn), asc(groupExpenses.id));
  for (const expense of expenseRows) await reconcileGroupExpense(transaction, expense.id);
  const settlementRows = await transaction.select({ id: groupSettlements.id }).from(groupSettlements)
    .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupSettlements.groupId), or(eq(groupParticipants.id, groupSettlements.senderParticipantId), eq(groupParticipants.id, groupSettlements.recipientParticipantId)), eq(groupParticipants.userId, ownerUserId)))
    .where(and(eq(groupSettlements.state, "confirmed"), gte(groupSettlements.paidOn, period.startsOn), lte(groupSettlements.paidOn, period.endsOn), sql`not exists (select 1 from ${budgetGroupSettlementSources} source where source.owner_user_id = ${ownerUserId} and source.group_settlement_id = ${groupSettlements.id})`))
    .orderBy(asc(groupSettlements.paidOn), asc(groupSettlements.id));
  for (const settlement of settlementRows) await reconcileGroupSettlement(transaction, settlement.id, [ownerUserId]);
  return { expenseCount: expenseRows.length, settlementCount: settlementRows.length };
}

export async function changeGroupExpenseBudgetCategory(database: Database, ownerUserId: string, transactionId: string, categoryId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [category] = await transaction.select().from(budgetCategories).where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, categoryId), isNull(budgetCategories.archivedAt))).limit(1).for("update");
    if (!category) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
    const [lockedTransaction] = await transaction.select().from(budgetTransactions)
      .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId), eq(budgetTransactions.status, "posted")))
      .limit(1)
      .for("update");
    if (!lockedTransaction) throw new BudgetError("NOT_FOUND", "That linked Group Expense is no longer available.");
    const impacts = await lockImpacts(transaction as LedgerTransaction, ownerUserId, transactionId);
    const [source] = await transaction.select({ source: budgetGroupExpenseSources, expense: groupExpenses })
      .from(budgetGroupExpenseSources)
      .innerJoin(groupExpenses, eq(groupExpenses.id, budgetGroupExpenseSources.groupExpenseId))
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupExpenses.groupId), eq(groupParticipants.id, groupExpenses.payerParticipantId), eq(groupParticipants.userId, ownerUserId)))
      .where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetGroupExpenseSources.budgetTransactionId, transactionId), eq(groupExpenses.state, "confirmed")))
      .limit(1);
    if (!source) throw new BudgetError("NOT_FOUND", "That linked Group Expense is no longer available.");
    if (impacts.length > 0) {
      await transaction.update(budgetImpacts).set({ budgetCategoryId: category.id, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, transactionId)));
    } else {
      const period = await activePeriod(transaction as LedgerTransaction, ownerUserId);
      if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
      await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: transactionId, budgetCategoryId: category.id, budgetPeriodId: period.id, amount: lockedTransaction.amount, status: "applied", targetPeriodOrdinal: period.ordinal });
    }
    const settlementRows = await transaction.select({ settlementId: groupSettlementApplications.settlementId })
      .from(groupSettlementApplications)
      .innerJoin(groupObligations, and(eq(groupObligations.groupId, groupSettlementApplications.groupId), eq(groupObligations.id, groupSettlementApplications.obligationId), eq(groupObligations.sourceExpenseId, source.expense.id)))
      .innerJoin(groupSettlements, and(eq(groupSettlements.id, groupSettlementApplications.settlementId), eq(groupSettlements.state, "confirmed"), eq(groupSettlements.recipientParticipantId, source.expense.payerParticipantId)))
      .where(eq(groupSettlementApplications.groupId, source.expense.groupId));
    const period = await activePeriod(transaction as LedgerTransaction, ownerUserId);
    for (const settlement of uniqueIds(settlementRows.map((row) => row.settlementId))) await reconcileGroupSettlementForOwner(transaction as LedgerTransaction, ownerUserId, settlement, period);
  });
}

export async function changeGroupObligationBudgetCategory(database: Database, ownerUserId: string, obligationId: string, categoryId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [category] = await transaction.select().from(budgetCategories).where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, categoryId), isNull(budgetCategories.archivedAt))).limit(1).for("update");
    if (!category) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
    await transaction.select({ groupObligationId: budgetGroupObligationClassifications.groupObligationId })
      .from(budgetGroupObligationClassifications)
      .where(and(eq(budgetGroupObligationClassifications.ownerUserId, ownerUserId), eq(budgetGroupObligationClassifications.groupObligationId, obligationId)))
      .limit(1)
      .for("update");
    const [obligation] = await transaction.select({ id: groupObligations.id, debtorUserId: groupParticipants.userId })
      .from(groupObligations)
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupObligations.groupId), eq(groupParticipants.id, groupObligations.debtorParticipantId), eq(groupParticipants.userId, ownerUserId)))
      .where(eq(groupObligations.id, obligationId)).limit(1);
    if (!obligation || obligation.debtorUserId !== ownerUserId) throw new BudgetError("NOT_FOUND", "That Group obligation is no longer available.");
    await transaction.insert(budgetGroupObligationClassifications).values({ ownerUserId, groupObligationId: obligationId, budgetCategoryId: category.id })
      .onConflictDoUpdate({ target: [budgetGroupObligationClassifications.ownerUserId, budgetGroupObligationClassifications.groupObligationId], set: { budgetCategoryId: category.id, updatedAt: new Date() } });
    const settlementRows = await transaction.select({ settlementId: groupSettlementApplications.settlementId })
      .from(groupSettlementApplications)
      .innerJoin(groupObligations, and(
        eq(groupObligations.groupId, groupSettlementApplications.groupId),
        eq(groupObligations.id, groupSettlementApplications.obligationId),
        eq(groupObligations.id, obligationId),
      ))
      .innerJoin(groupSettlements, and(eq(groupSettlements.id, groupSettlementApplications.settlementId), eq(groupSettlements.state, "confirmed"), eq(groupSettlements.senderParticipantId, groupObligations.debtorParticipantId)))
      .where(eq(groupSettlementApplications.obligationId, obligationId));
    const period = await activePeriod(transaction as LedgerTransaction, ownerUserId);
    for (const settlement of uniqueIds(settlementRows.map((row) => row.settlementId))) await reconcileGroupSettlementForOwner(transaction as LedgerTransaction, ownerUserId, settlement, period);
  });
}

export async function readGroupBudgetSharedMoney(database: Database, ownerUserId: string): Promise<GroupBudgetSharedMoney> {
  const ownerParticipants = await database
    .select({ groupId: groupParticipants.groupId, participantId: groupParticipants.id })
    .from(groupParticipants)
    .where(eq(groupParticipants.userId, ownerUserId));
  const ownerParticipantIds = uniqueIds(ownerParticipants.map(({ participantId }) => participantId));
  if (ownerParticipantIds.length === 0) return { expectedBack: 0, stillOwe: 0, obligations: [] };
  const available = await loadAvailableGroupObligationsForParticipants(database, ownerParticipantIds, new Date());
  const outstanding = new Map(available.map((obligation) => [obligation.id, obligation]));
  const rows = outstanding.size === 0 ? [] : await database.select({
    id: groupObligations.id,
    groupId: groupObligations.groupId,
    groupName: groups.name,
    description: groupExpenses.description,
  }).from(groupObligations)
    .innerJoin(groups, eq(groups.id, groupObligations.groupId))
    .innerJoin(groupExpenses, and(eq(groupExpenses.id, groupObligations.sourceExpenseId), eq(groupExpenses.groupId, groupObligations.groupId)))
    .where(inArray(groupObligations.id, [...outstanding.keys()]));
  const details = new Map(rows.map((row) => [row.id, row]));
  const classifications = outstanding.size === 0 ? [] : await database
    .select({ obligationId: budgetGroupObligationClassifications.groupObligationId, categoryId: budgetGroupObligationClassifications.budgetCategoryId, categoryName: budgetCategories.name })
    .from(budgetGroupObligationClassifications)
    .innerJoin(groupObligations, eq(groupObligations.id, budgetGroupObligationClassifications.groupObligationId))
    .innerJoin(groupParticipants, and(
      eq(groupParticipants.groupId, groupObligations.groupId),
      eq(groupParticipants.id, groupObligations.debtorParticipantId),
      eq(groupParticipants.userId, ownerUserId),
    ))
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetGroupObligationClassifications.budgetCategoryId), isNull(budgetCategories.archivedAt)))
    .where(and(eq(budgetGroupObligationClassifications.ownerUserId, ownerUserId), inArray(budgetGroupObligationClassifications.groupObligationId, [...outstanding.keys()])));
  const categoryById = new Map(classifications.map((row) => [row.obligationId, { id: row.categoryId, name: row.categoryName }]));
  const ownerParticipantIdSet = new Set(ownerParticipantIds);
  let expectedBack = 0;
  let stillOwe = 0;
  const obligations: GroupBudgetObligation[] = [];
  for (const [id, obligation] of outstanding) {
    const amount = obligation.originalAmount - obligation.paymentAppliedAmount - obligation.offsetAppliedAmount;
    if (amount <= 0) continue;
    if (ownerParticipantIdSet.has(obligation.creditorParticipantId)) expectedBack += amount;
    if (!ownerParticipantIdSet.has(obligation.debtorParticipantId)) continue;
    stillOwe += amount;
    const detail = details.get(id);
    if (!detail) continue;
    const category = categoryById.get(id);
    obligations.push({ id, groupId: detail.groupId, groupName: detail.groupName, description: detail.description, amount, categoryId: category?.id ?? null, categoryName: category?.name ?? "Uncategorized" });
  }
  return { expectedBack, stillOwe, obligations };
}

export async function readGroupBudgetObligations(database: Database, ownerUserId: string) {
  return (await readGroupBudgetSharedMoney(database, ownerUserId)).obligations;
}
