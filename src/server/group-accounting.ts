import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import { groupExpenseReceipts, groupExpenseShares, groupExpenses, groupObligations, groupMemberships, groupParticipants, users } from "@/db/schema";
import { requireSession } from "@/auth/require-session";
import { buildGroupObligations, normalizeGroupExpenseInput, type GroupExpenseInput } from "@/domain/group-accounting";
import type { GroupParticipantEligibility } from "@/domain/group-contracts";
import { clampPage, escapeLikePattern, normalizePage, normalizeText, normalizeUuid, pageResult, RECORD_PAGE_SIZE, type RecordPage } from "@/domain/record-retrieval";
import { GroupError, requireGroupAccess } from "@/server/groups";

export class GroupAccountingError extends Error {
  constructor(readonly code: "invalid_id" | "invalid_user" | "not_found" | "not_member" | "forbidden" | "payer_not_found" | "payer_external" | "payer_not_active" | "participant_not_found" | "participant_not_eligible" | "share_total_mismatch" | "invalid_state" | "financial_integrity") {
    super(code);
    this.name = "GroupAccountingError";
  }
}

export type GroupExpenseRecord = typeof groupExpenses.$inferSelect;
export type GroupExpenseShareRecord = typeof groupExpenseShares.$inferSelect;
export type GroupObligationRecord = typeof groupObligations.$inferSelect;
export type GroupParticipantPresentation = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  status: "active" | "former" | "external";
};
export type GroupExpenseSharePresentation = GroupExpenseShareRecord & { participant: GroupParticipantPresentation };
export type GroupObligationPresentation = GroupObligationRecord & { debtor: GroupParticipantPresentation; creditor: GroupParticipantPresentation };
export type GroupExpenseReceiptMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};
export type GroupExpenseListRecord = GroupExpenseRecord & { payer: GroupParticipantPresentation; shareCount: number };
export type GroupExpenseDetail = GroupExpenseRecord & { creator: GroupParticipantPresentation; payer: GroupParticipantPresentation; shares: GroupExpenseSharePresentation[]; obligations: GroupObligationPresentation[]; receipts: GroupExpenseReceiptMetadata[] };
function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function assertGroupId(groupId: string) {
  if (!normalizeUuid(groupId)) throw new GroupAccountingError("invalid_id");
}

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new GroupAccountingError("invalid_user");
}

function mapGroupError(error: unknown): never {
  if (error instanceof GroupError) {
    if (error.code === "not_member") throw new GroupAccountingError("not_member");
    if (error.code === "invalid_id") throw new GroupAccountingError("invalid_id");
    if (error.code === "forbidden") throw new GroupAccountingError("forbidden");
  }
  throw error;
}

function expenseColumns() {
  return {
    id: groupExpenses.id,
    groupId: groupExpenses.groupId,
    creatorParticipantId: groupExpenses.creatorParticipantId,
    payerParticipantId: groupExpenses.payerParticipantId,
    description: groupExpenses.description,
    occurredAt: groupExpenses.occurredAt,
    totalAmount: groupExpenses.totalAmount,
    state: groupExpenses.state,
    confirmedAt: groupExpenses.confirmedAt,
    createdAt: groupExpenses.createdAt,
    updatedAt: groupExpenses.updatedAt,
  };
}

async function loadParticipantMap(database: Database, groupId: string, participantIds: string[]) {
  const uniqueIds = [...new Set(participantIds)];
  if (!uniqueIds.length) return new Map<string, GroupParticipantPresentation>();
  const rows = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId, externalName: groupParticipants.displayName, label: groupParticipants.label, userName: users.name, membershipUserId: groupMemberships.userId })
    .from(groupParticipants)
    .leftJoin(users, eq(users.id, groupParticipants.userId))
    .leftJoin(groupMemberships, and(eq(groupMemberships.groupId, groupParticipants.groupId), eq(groupMemberships.participantId, groupParticipants.id)))
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, uniqueIds)));
  return new Map(rows.map((row) => {
    const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
    return [row.id, { id: row.id, userId: row.userId, displayName: row.userName ?? row.externalName ?? "Participant", label: row.label, status } satisfies GroupParticipantPresentation];
  }));
}

async function loadExpense(database: Database, groupId: string, expenseId: string): Promise<GroupExpenseDetail> {
  const [expense] = await database.select(expenseColumns()).from(groupExpenses).where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId))).limit(1);
  if (!expense) throw new GroupAccountingError("not_found");
  const [shares, obligations, receipts] = await Promise.all([
    database.select().from(groupExpenseShares).where(and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenseShares.expenseId, expenseId))).orderBy(asc(groupExpenseShares.createdAt), asc(groupExpenseShares.id)),
    database.select().from(groupObligations).where(and(eq(groupObligations.groupId, groupId), eq(groupObligations.sourceExpenseId, expenseId))).orderBy(asc(groupObligations.createdAt), asc(groupObligations.id)),
    database.select({ id: groupExpenseReceipts.id, originalFilename: groupExpenseReceipts.originalFilename, mediaType: groupExpenseReceipts.mediaType, byteSize: groupExpenseReceipts.byteSize, createdAt: groupExpenseReceipts.createdAt }).from(groupExpenseReceipts).where(and(eq(groupExpenseReceipts.groupId, groupId), eq(groupExpenseReceipts.expenseId, expenseId))).orderBy(asc(groupExpenseReceipts.createdAt), asc(groupExpenseReceipts.id)),
  ]);
  const participantMap = await loadParticipantMap(database, groupId, [expense.creatorParticipantId, expense.payerParticipantId, ...shares.map((share) => share.participantId), ...obligations.flatMap((obligation) => [obligation.debtorParticipantId, obligation.creditorParticipantId])]);
  const participant = (id: string) => participantMap.get(id) ?? { id, userId: null, displayName: "Participant", label: null, status: "former" as const };
  return {
    ...expense,
    creator: participant(expense.creatorParticipantId),
    payer: participant(expense.payerParticipantId),
    shares: shares.map((share) => ({ ...share, participant: participant(share.participantId) })),
    obligations: obligations.map((obligation) => ({ ...obligation, debtor: participant(obligation.debtorParticipantId), creditor: participant(obligation.creditorParticipantId) })),
    receipts,
  };
}

async function getActiveParticipantForUser(database: Database, groupId: string, userId: string) {
  const [row] = await database
    .select({ participantId: groupMemberships.participantId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
    .limit(1)
    .for("update");
  if (!row) throw new GroupAccountingError("not_member");
  return row.participantId;
}

async function lockExpenseEligibility(database: Database, groupId: string, creatorUserId: string, values: GroupExpenseInput) {
  const shareTotal = values.shares.reduce((total, share) => total + BigInt(share.amount), BigInt(0));
  if (shareTotal !== BigInt(values.totalAmount)) throw new GroupAccountingError("share_total_mismatch");
  const [creatorMembership] = await database
    .select({ participantId: groupMemberships.participantId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, creatorUserId)))
    .limit(1);
  if (!creatorMembership) throw new GroupAccountingError("not_member");

  const participantIds = [...new Set([creatorMembership.participantId, values.payerParticipantId, ...values.shares.map(({ participantId }) => participantId)])].sort();
  const participants = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, participantIds)))
    .orderBy(asc(groupParticipants.id))
    .for("update");

  const memberships = await database
    .select({ participantId: groupMemberships.participantId, userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), inArray(groupMemberships.participantId, participantIds)))
    .orderBy(asc(groupMemberships.participantId), asc(groupMemberships.userId))
    .for("update");

  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const membershipByParticipantId = new Map(memberships.map((membership) => [membership.participantId, membership]));
  const creator = participantById.get(creatorMembership.participantId);
  if (!creator || creator.userId !== creatorUserId || membershipByParticipantId.get(creator.id)?.userId !== creatorUserId) throw new GroupAccountingError("not_member");
  const payer = participantById.get(values.payerParticipantId);
  if (!payer) throw new GroupAccountingError("payer_not_found");
  if (!payer.userId) throw new GroupAccountingError("payer_external");
  const payerMembership = membershipByParticipantId.get(payer.id);
  if (!payerMembership || payerMembership.userId !== payer.userId) throw new GroupAccountingError("payer_not_active");
  const shares = values.shares.map((share) => participantById.get(share.participantId));
  if (shares.some((participant) => !participant)) throw new GroupAccountingError("participant_not_found");
  for (const participant of shares) {
    if (participant?.userId && membershipByParticipantId.get(participant.id)?.userId !== participant.userId) throw new GroupAccountingError("participant_not_eligible");
  }
  return { creatorParticipantId: creator.id };
}

async function assertPayer(database: Database, groupId: string, participantId: string) {
  const [participant] = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, participantId)))
    .limit(1)
    .for("update");
  if (!participant) throw new GroupAccountingError("payer_not_found");
  if (!participant.userId) throw new GroupAccountingError("payer_external");
  const [membership] = await database
    .select({ participantId: groupMemberships.participantId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, participant.userId), eq(groupMemberships.participantId, participant.id)))
    .limit(1)
    .for("update");
  if (!membership) throw new GroupAccountingError("payer_not_active");
  return participant;
}

async function materializeObligations(database: Database, groupId: string, expense: GroupExpenseRecord, shares: GroupExpenseShareRecord[]) {
  const obligations = buildGroupObligations(expense.payerParticipantId, shares.map((share) => ({ id: share.id, participantId: share.participantId, amount: share.amount })));
  if (obligations.length === 0) return;
  await database.insert(groupObligations).values(obligations.map((obligation) => ({
    groupId,
    sourceExpenseId: expense.id,
    sourceShareId: obligation.sourceShareId!,
    debtorParticipantId: obligation.debtorParticipantId,
    creditorParticipantId: obligation.creditorParticipantId,
    originalAmount: obligation.originalAmount,
  })));
}

async function confirmPendingExpense(database: Database, groupId: string, expenseId: string, payerParticipantId: string, now: Date) {
  const [expense] = await database.select().from(groupExpenses).where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId))).limit(1).for("update");
  if (!expense) throw new GroupAccountingError("not_found");
  if (expense.payerParticipantId !== payerParticipantId) throw new GroupAccountingError("forbidden");
  if (expense.state === "confirmed") return expense;
  if (expense.state !== "pending") throw new GroupAccountingError("invalid_state");
  const shares = await database.select().from(groupExpenseShares).where(and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenseShares.expenseId, expenseId))).orderBy(asc(groupExpenseShares.createdAt), asc(groupExpenseShares.id));
  const shareTotal = shares.reduce((total, share) => total + BigInt(share.amount), BigInt(0));
  if (shareTotal !== BigInt(expense.totalAmount)) throw new GroupAccountingError("share_total_mismatch");
  const [confirmed] = await database
    .update(groupExpenses)
    .set({ state: "confirmed", confirmedAt: now, updatedAt: now })
    .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId), eq(groupExpenses.state, "pending")))
    .returning();
  if (!confirmed) return confirmPendingExpense(database, groupId, expenseId, payerParticipantId, now);
  await materializeObligations(database, groupId, confirmed, shares);
  return confirmed;
}

async function createExpense(database: Database, groupId: string, creatorUserId: string, input: unknown) {
  assertGroupId(groupId);
  assertUserId(creatorUserId);
  const values = normalizeGroupExpenseInput(input);
  try {
    return await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      await requireGroupAccess(transactionalDatabase, groupId, creatorUserId);
      const { creatorParticipantId } = await lockExpenseEligibility(transactionalDatabase, groupId, creatorUserId, values);
      const now = new Date();
      const [expense] = await transaction
        .insert(groupExpenses)
        .values({ groupId, creatorParticipantId, payerParticipantId: values.payerParticipantId, description: values.description, occurredAt: values.occurredAt, totalAmount: values.totalAmount, state: "pending", createdAt: now, updatedAt: now })
        .returning();
      if (!expense) throw new Error("Group expense was not created");
      const shares = await transaction
        .insert(groupExpenseShares)
        .values(values.shares.map((share) => ({ groupId, expenseId: expense.id, participantId: share.participantId, amount: share.amount, createdAt: now, updatedAt: now })))
        .returning();
      if (shares.length !== values.shares.length) throw new Error("Group expense shares were not created");
      if (creatorParticipantId === values.payerParticipantId) await confirmPendingExpense(transactionalDatabase, groupId, expense.id, values.payerParticipantId, now);
      return loadExpense(transactionalDatabase, groupId, expense.id);
    });
  } catch (error) {
    if (error instanceof GroupError) mapGroupError(error);
    if (databaseCode(error) === "23514") throw new GroupAccountingError("financial_integrity");
    throw error;
  }
}

export function createGroupAccountingRepository(database: Database, groupId: string) {
  assertGroupId(groupId);

  async function authorize(userId: string) {
    assertUserId(userId);
    try {
      await requireGroupAccess(database, groupId, userId);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async function getExpense(expenseId: string, viewerUserId: string) {
    if (!normalizeUuid(expenseId)) throw new GroupAccountingError("not_found");
    await authorize(viewerUserId);
    return loadExpense(database, groupId, expenseId);
  }

  async function listExpenses(viewerUserId: string, requestedPage: unknown = 1, filters: { q?: unknown; state?: unknown } = {}): Promise<RecordPage<GroupExpenseListRecord>> {
    await authorize(viewerUserId);
    const page = Math.min(normalizePage(requestedPage), 1_000_000);
    const query = normalizeText(filters.q);
    const state = filters.state === "pending" || filters.state === "confirmed" ? filters.state : undefined;
    const where = and(eq(groupExpenses.groupId, groupId), ...(query ? [ilike(groupExpenses.description, `%${escapeLikePattern(query)}%`)] : []), ...(state ? [eq(groupExpenses.state, state)] : []));
    const [{ totalItems }] = await database.select({ totalItems: count() }).from(groupExpenses).where(where);
    const total = Number(totalItems);
    const actualPage = clampPage(page, total);
    const items = await database.select({ ...expenseColumns(), shareCount: sql<number>`(select count(*) from group_expense_shares shares where shares.group_id = ${groupId} and shares.expense_id = ${groupExpenses.id})`.mapWith(Number) }).from(groupExpenses).where(where).orderBy(desc(groupExpenses.occurredAt), desc(groupExpenses.id)).limit(RECORD_PAGE_SIZE).offset((actualPage - 1) * RECORD_PAGE_SIZE);
    const participantMap = await loadParticipantMap(database, groupId, items.map((item) => item.payerParticipantId));
    return pageResult(items.map((item) => ({ ...item, shareCount: Number(item.shareCount), payer: participantMap.get(item.payerParticipantId) ?? { id: item.payerParticipantId, userId: null, displayName: "Participant", label: null, status: "former" as const } })), total, actualPage);
  }

  async function getShares(expenseId: string, viewerUserId: string) {
    const expense = await getExpense(expenseId, viewerUserId);
    return expense.shares;
  }

  async function getSourceObligations(expenseId: string, viewerUserId: string) {
    const expense = await getExpense(expenseId, viewerUserId);
    return expense.obligations;
  }

  async function getParticipantEligibility(viewerUserId: string): Promise<GroupParticipantEligibility[]> {
    await authorize(viewerUserId);
    const rows = await database
      .select({ id: groupParticipants.id, userId: groupParticipants.userId, externalName: groupParticipants.displayName, label: groupParticipants.label, userName: users.name, membershipUserId: groupMemberships.userId })
      .from(groupParticipants)
      .leftJoin(users, eq(users.id, groupParticipants.userId))
      .leftJoin(groupMemberships, and(eq(groupMemberships.groupId, groupParticipants.groupId), eq(groupMemberships.participantId, groupParticipants.id)))
      .where(eq(groupParticipants.groupId, groupId))
      .orderBy(asc(groupParticipants.userId), asc(groupParticipants.displayName), asc(groupParticipants.id));
    return rows.map((row) => {
      const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
      return { id: row.id, userId: row.userId, displayName: row.userName ?? row.externalName ?? "Participant", label: row.label, status, canCreate: status === "active", canPay: status === "active", canParticipate: status !== "former", canBeCreditor: status === "active" };
    });
  }

  return {
    createExpense: (creatorUserId: string, input: unknown) => createExpense(database, groupId, creatorUserId, input),
    confirmExpenseAsPayer: async (expenseId: string, payerUserId: string) => {
      if (!normalizeUuid(expenseId)) throw new GroupAccountingError("not_found");
      assertUserId(payerUserId);
      return database.transaction(async (transaction) => {
        const transactionalDatabase = transaction as Database;
        await requireGroupAccess(transactionalDatabase, groupId, payerUserId);
        const [expense] = await transactionalDatabase.select().from(groupExpenses).where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId))).limit(1).for("update");
        if (!expense) throw new GroupAccountingError("not_found");
        const [payer] = await transactionalDatabase.select({ userId: groupParticipants.userId }).from(groupParticipants).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, expense.payerParticipantId))).limit(1);
        if (!payer?.userId || payer.userId !== payerUserId) throw new GroupAccountingError("forbidden");
        await assertPayer(transactionalDatabase, groupId, expense.payerParticipantId);
        if (expense.state === "confirmed") return loadExpense(transactionalDatabase, groupId, expenseId);
        const activeParticipantId = await getActiveParticipantForUser(transactionalDatabase, groupId, payerUserId);
        if (activeParticipantId !== expense.payerParticipantId) throw new GroupAccountingError("forbidden");
        await confirmPendingExpense(transactionalDatabase, groupId, expenseId, activeParticipantId, new Date());
        return loadExpense(transactionalDatabase, groupId, expenseId);
      }).catch((error) => {
        if (error instanceof GroupError) mapGroupError(error);
        throw error;
      });
    },
    getExpense,
    listExpenses,
    getShares,
    getSourceObligations,
    getParticipantEligibility,
  };
}

export async function createGroupExpense(database: Database, groupId: string, creatorUserId: string, input: unknown) {
  return createGroupAccountingRepository(database, groupId).createExpense(creatorUserId, input);
}

export async function createGroupExpenseForCurrentUser(groupId: string, input: unknown) {
  const session = await requireSession();
  return createGroupExpense(getDatabase(), groupId, session.user.id, input);
}

export async function confirmGroupExpenseAsPayer(database: Database, groupId: string, expenseId: string, payerUserId: string) {
  return createGroupAccountingRepository(database, groupId).confirmExpenseAsPayer(expenseId, payerUserId);
}

export async function confirmGroupExpenseAsCurrentUser(groupId: string, expenseId: string) {
  const session = await requireSession();
  return confirmGroupExpenseAsPayer(getDatabase(), groupId, expenseId, session.user.id);
}
