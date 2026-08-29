import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import {
  groupExpenseLifecycleEvents,
  groupExpenseReceipts,
  groupExpenseShares,
  groupExpenses,
  groupObligations,
  groupMemberships,
  groupParticipants,
  groupSettlements,
  groups,
  notifications,
  users,
} from "@/db/schema";
import { requireSession } from "@/auth/require-session";
import {
  buildGroupObligations,
  calculateGroupBalances,
  GROUP_EXPENSE_STATE_CHANGED_EVENT,
  normalizeGroupExpenseInput,
  type GroupExpenseInput,
  type GroupExpenseLifecycleEventType,
} from "@/domain/group-accounting";
import type { GroupParticipantEligibility } from "@/domain/group-contracts";
import { NOTIFICATION_TYPES } from "@/domain/notifications";
import {
  clampPage,
  escapeLikePattern,
  normalizePage,
  normalizeText,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "@/domain/record-retrieval";
import { GroupError, requireGroupAccess } from "@/server/groups";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { publishRealtimeEvent } from "@/server/realtime";

export class GroupAccountingError extends Error {
  constructor(
    readonly code:
      | "invalid_id"
      | "invalid_user"
      | "not_found"
      | "not_member"
      | "forbidden"
      | "payer_not_found"
      | "payer_external"
      | "payer_not_active"
      | "participant_not_found"
      | "participant_not_eligible"
      | "share_total_mismatch"
      | "invalid_state"
      | "financial_integrity",
  ) {
    super(code);
    this.name = "GroupAccountingError";
  }
}

export type GroupExpenseRecord = typeof groupExpenses.$inferSelect;
export type GroupExpenseShareRecord = typeof groupExpenseShares.$inferSelect;
export type GroupObligationRecord = typeof groupObligations.$inferSelect;
export type GroupExpenseLifecycleEventRecord = typeof groupExpenseLifecycleEvents.$inferSelect;
export type GroupParticipantPresentation = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  status: "active" | "former" | "external";
};
export type GroupExpenseSharePresentation = GroupExpenseShareRecord & {
  participant: GroupParticipantPresentation;
};
export type GroupObligationPresentation = GroupObligationRecord & {
  debtor: GroupParticipantPresentation;
  creditor: GroupParticipantPresentation;
};
export type GroupBalanceRecord = ReturnType<typeof calculateGroupBalances>[number];
export type GroupExpenseReceiptMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};
export type GroupExpenseListRecord = GroupExpenseRecord & {
  payer: GroupParticipantPresentation;
  shareCount: number;
};
export type GroupExpenseDetail = GroupExpenseRecord & {
  creator: GroupParticipantPresentation;
  payer: GroupParticipantPresentation;
  shares: GroupExpenseSharePresentation[];
  obligations: GroupObligationPresentation[];
  receipts: GroupExpenseReceiptMetadata[];
  lifecycleEvents: GroupExpenseLifecycleEventRecord[];
};
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
    .select({
      id: groupParticipants.id,
      userId: groupParticipants.userId,
      externalName: groupParticipants.displayName,
      label: groupParticipants.label,
      userName: users.name,
      membershipUserId: groupMemberships.userId,
    })
    .from(groupParticipants)
    .leftJoin(users, eq(users.id, groupParticipants.userId))
    .leftJoin(
      groupMemberships,
      and(
        eq(groupMemberships.groupId, groupParticipants.groupId),
        eq(groupMemberships.participantId, groupParticipants.id),
      ),
    )
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, uniqueIds)));
  return new Map(rows.map((row) => {
    const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
    return [row.id, { id: row.id, userId: row.userId, displayName: row.userName ?? row.externalName ?? "Participant", label: row.label, status } satisfies GroupParticipantPresentation];
  }));
}

async function loadExpense(database: Database, groupId: string, expenseId: string): Promise<GroupExpenseDetail> {
  const [expense] = await database
    .select(expenseColumns())
    .from(groupExpenses)
    .where(
      and(
        eq(groupExpenses.groupId, groupId),
        eq(groupExpenses.id, expenseId),
      ),
    )
    .limit(1);
  if (!expense) throw new GroupAccountingError("not_found");
  const [shares, obligations, receipts, lifecycleEvents] = await Promise.all([
    database
      .select()
      .from(groupExpenseShares)
      .where(
        and(
          eq(groupExpenseShares.groupId, groupId),
          eq(groupExpenseShares.expenseId, expenseId),
        ),
      )
      .orderBy(asc(groupExpenseShares.createdAt), asc(groupExpenseShares.id)),
    database
      .select()
      .from(groupObligations)
      .where(
        and(
          eq(groupObligations.groupId, groupId),
          eq(groupObligations.sourceExpenseId, expenseId),
        ),
      )
      .orderBy(asc(groupObligations.createdAt), asc(groupObligations.id)),
    database
      .select({
        id: groupExpenseReceipts.id,
        originalFilename: groupExpenseReceipts.originalFilename,
        mediaType: groupExpenseReceipts.mediaType,
        byteSize: groupExpenseReceipts.byteSize,
        createdAt: groupExpenseReceipts.createdAt,
      })
      .from(groupExpenseReceipts)
      .where(
        and(
          eq(groupExpenseReceipts.groupId, groupId),
          eq(groupExpenseReceipts.expenseId, expenseId),
        ),
      )
      .orderBy(asc(groupExpenseReceipts.createdAt), asc(groupExpenseReceipts.id)),
    database
      .select()
      .from(groupExpenseLifecycleEvents)
      .where(
        and(
          eq(groupExpenseLifecycleEvents.groupId, groupId),
          eq(groupExpenseLifecycleEvents.expenseId, expenseId),
        ),
      )
      .orderBy(
        asc(groupExpenseLifecycleEvents.createdAt),
        asc(groupExpenseLifecycleEvents.id),
      ),
  ]);
  const participantMap = await loadParticipantMap(database, groupId, [
    expense.creatorParticipantId,
    expense.payerParticipantId,
    ...shares.map((share) => share.participantId),
    ...obligations.flatMap((obligation) => [
      obligation.debtorParticipantId,
      obligation.creditorParticipantId,
    ]),
  ]);
  const participant = (id: string) => participantMap.get(id) ?? { id, userId: null, displayName: "Participant", label: null, status: "former" as const };
  return {
    ...expense,
    creator: participant(expense.creatorParticipantId),
    payer: participant(expense.payerParticipantId),
    shares: shares.map((share) => ({ ...share, participant: participant(share.participantId) })),
    obligations: obligations.map((obligation) => ({
      ...obligation,
      debtor: participant(obligation.debtorParticipantId),
      creditor: participant(obligation.creditorParticipantId),
    })),
    receipts,
    lifecycleEvents,
  };
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

  const participantIds = [
    ...new Set([
      creatorMembership.participantId,
      values.payerParticipantId,
      ...values.shares.map(({ participantId }) => participantId),
    ]),
  ].sort();
  const participants = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, participantIds)))
    .orderBy(asc(groupParticipants.id))
    .for("update");

  const memberships = await database
    .select({
      participantId: groupMemberships.participantId,
      userId: groupMemberships.userId,
    })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), inArray(groupMemberships.participantId, participantIds)))
    .orderBy(asc(groupMemberships.participantId), asc(groupMemberships.userId))
    .for("update");

  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const membershipByParticipantId = new Map(memberships.map((membership) => [membership.participantId, membership]));
  const creator = participantById.get(creatorMembership.participantId);
  if (
    !creator ||
    creator.userId !== creatorUserId ||
    membershipByParticipantId.get(creator.id)?.userId !== creatorUserId
  ) throw new GroupAccountingError("not_member");
  const payer = participantById.get(values.payerParticipantId);
  if (!payer) throw new GroupAccountingError("payer_not_found");
  if (!payer.userId) throw new GroupAccountingError("payer_external");
  const payerMembership = membershipByParticipantId.get(payer.id);
  if (!payerMembership || payerMembership.userId !== payer.userId) throw new GroupAccountingError("payer_not_active");
  const shares = values.shares.map((share) => participantById.get(share.participantId));
  if (shares.some((participant) => !participant)) throw new GroupAccountingError("participant_not_found");
  for (const participant of shares) {
    if (
      participant?.userId &&
      membershipByParticipantId.get(participant.id)?.userId !== participant.userId
    ) throw new GroupAccountingError("participant_not_eligible");
  }
  return { creatorParticipantId: creator.id, payerUserId: payer.userId };
}

async function lockActivePayer(database: Database, groupId: string, participantId: string) {
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
  if (!membership) throw new GroupAccountingError("not_member");
  return { id: participant.id, userId: participant.userId };
}

// Lock every participant involved before materializing obligations.
async function lockActivePayerForExpense(database: Database, groupId: string, expense: GroupExpenseRecord, payerUserId: string) {
  const shares = await database
    .select({ participantId: groupExpenseShares.participantId })
    .from(groupExpenseShares)
    .where(and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenseShares.expenseId, expense.id)))
    .orderBy(asc(groupExpenseShares.participantId));
  const participantIds = [...new Set([expense.payerParticipantId, ...shares.map(({ participantId }) => participantId)])].sort();
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
  const payer = participants.find(({ id }) => id === expense.payerParticipantId);
  if (!payer) throw new GroupAccountingError("payer_not_found");
  if (!payer.userId) throw new GroupAccountingError("payer_external");
  const membership = memberships.find(({ participantId }) => participantId === payer.id);
  if (!membership) throw new GroupAccountingError("not_member");
  if (payer.userId !== payerUserId) throw new GroupAccountingError("forbidden");
  return { id: payer.id, userId: payer.userId };
}

async function materializeObligations(database: Database, groupId: string, expense: GroupExpenseRecord, shares: GroupExpenseShareRecord[]) {
  const obligations = buildGroupObligations(
    expense.payerParticipantId,
    shares.map((share) => ({
      id: share.id,
      participantId: share.participantId,
      amount: share.amount,
    })),
  );
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

async function appendLifecycleEvent(
  database: Database,
  values: {
    groupId: string;
    expenseId: string;
    eventType: GroupExpenseLifecycleEventType;
    actorUserId: string;
    fromState: GroupExpenseRecord["state"] | null;
    toState: GroupExpenseRecord["state"];
  },
) {
  const [event] = await database.insert(groupExpenseLifecycleEvents).values(values).returning();
  if (!event) throw new Error("Group expense lifecycle event was not created");
  return event;
}

async function resolvePayerClaimNotification(database: Database, expenseId: string, payerUserId: string, now: Date) {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(
      eq(notifications.recipientUserId, payerUserId),
      eq(notifications.type, NOTIFICATION_TYPES.groupExpensePayerClaim),
      eq(notifications.dedupeKey, `group-expense-payer-claim:${expenseId}`),
      isNull(notifications.readAt),
    ));
}

async function confirmPendingExpense(
  database: Database,
  groupId: string,
  expenseId: string,
  payerParticipantId: string,
  actorUserId: string,
  eventType: "created" | "payer_confirmed",
  now: Date,
) {
  const [expense] = await database
    .select()
    .from(groupExpenses)
    .where(
      and(
        eq(groupExpenses.groupId, groupId),
        eq(groupExpenses.id, expenseId),
      ),
    )
    .limit(1)
    .for("update");
  if (!expense) throw new GroupAccountingError("not_found");
  if (expense.payerParticipantId !== payerParticipantId) throw new GroupAccountingError("forbidden");
  if (expense.state === "confirmed") return { expense, changed: false };
  if (expense.state !== "pending") throw new GroupAccountingError("invalid_state");
  const shares = await database
    .select()
    .from(groupExpenseShares)
    .where(
      and(
        eq(groupExpenseShares.groupId, groupId),
        eq(groupExpenseShares.expenseId, expenseId),
      ),
    )
    .orderBy(asc(groupExpenseShares.createdAt), asc(groupExpenseShares.id));
  const shareTotal = shares.reduce((total, share) => total + BigInt(share.amount), BigInt(0));
  if (shareTotal !== BigInt(expense.totalAmount)) throw new GroupAccountingError("share_total_mismatch");
  const [confirmed] = await database
    .update(groupExpenses)
    .set({ state: "confirmed", confirmedAt: now, updatedAt: now })
    .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId), eq(groupExpenses.state, "pending")))
    .returning();
  if (!confirmed) throw new GroupAccountingError("financial_integrity");
  await materializeObligations(database, groupId, confirmed, shares);
  await appendLifecycleEvent(database, {
    groupId,
    expenseId,
    eventType,
    actorUserId,
    fromState: eventType === "created" ? null : "pending",
    toState: "confirmed",
  });
  return { expense: confirmed, changed: true };
}

async function rejectPendingExpense(
  database: Database,
  groupId: string,
  expenseId: string,
  payerParticipantId: string,
  actorUserId: string,
  now: Date,
) {
  const [expense] = await database
    .select()
    .from(groupExpenses)
    .where(
      and(
        eq(groupExpenses.groupId, groupId),
        eq(groupExpenses.id, expenseId),
      ),
    )
    .limit(1)
    .for("update");
  if (!expense) throw new GroupAccountingError("not_found");
  if (expense.payerParticipantId !== payerParticipantId) throw new GroupAccountingError("forbidden");
  if (expense.state === "rejected") return { expense, changed: false };
  if (expense.state !== "pending") throw new GroupAccountingError("invalid_state");
  const [rejected] = await database
    .update(groupExpenses)
    .set({ state: "rejected", updatedAt: now })
    .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId), eq(groupExpenses.state, "pending")))
    .returning();
  if (!rejected) throw new GroupAccountingError("financial_integrity");
  await appendLifecycleEvent(database, {
    groupId,
    expenseId,
    eventType: "payer_rejected",
    actorUserId,
    fromState: "pending",
    toState: "rejected",
  });
  await resolvePayerClaimNotification(database, expenseId, actorUserId, now);
  return { expense: rejected, changed: true };
}

async function activeGroupUserIds(database: Database, groupId: string) {
  const rows = await database.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  return rows.map(({ userId }) => userId);
}

export async function readGroupBalances(database: Database, groupId: string): Promise<GroupBalanceRecord[]> {
  assertGroupId(groupId);
  const obligations = await database
    .select({
      debtorParticipantId: groupObligations.debtorParticipantId,
      creditorParticipantId: groupObligations.creditorParticipantId,
      originalAmount: groupObligations.originalAmount,
    })
    .from(groupObligations)
    .where(and(eq(groupObligations.groupId, groupId), isNull(groupObligations.voidedAt)));
  const settlements = await database
    .select({
      senderParticipantId: groupSettlements.senderParticipantId,
      recipientParticipantId: groupSettlements.recipientParticipantId,
      amount: groupSettlements.amount,
      state: groupSettlements.state,
    })
    .from(groupSettlements)
    .where(eq(groupSettlements.groupId, groupId));
  return calculateGroupBalances(obligations, settlements);
}

export async function getGroupBalances(database: Database, groupId: string, viewerUserId: string) {
  assertGroupId(groupId);
  assertUserId(viewerUserId);
  await requireGroupAccess(database, groupId, viewerUserId);
  return readGroupBalances(database, groupId);
}

function publishGroupExpenseFreshness(userIds: string[], groupId: string, expenseId: string, state: GroupExpenseRecord["state"]) {
  for (const userId of new Set(userIds)) {
    try {
      void publishRealtimeEvent(userId, { type: GROUP_EXPENSE_STATE_CHANGED_EVENT, data: { groupId, expenseId, state } }).catch(() => undefined);
    } catch {
      // Realtime is a non-authoritative freshness signal.
    }
  }
}

function obligationsMatchExpense(expense: GroupExpenseRecord, shares: GroupExpenseShareRecord[], obligations: GroupObligationRecord[]) {
  let expected;
  try {
    expected = buildGroupObligations(expense.payerParticipantId, shares.map((share) => ({ id: share.id, participantId: share.participantId, amount: share.amount })));
  } catch {
    return false;
  }
  if (expected.length !== obligations.length) return false;
  const actualByShareId = new Map(obligations.map((obligation) => [obligation.sourceShareId, obligation]));
  return expected.every((obligation) => {
    const actual = actualByShareId.get(obligation.sourceShareId!);
    return (
      actual?.debtorParticipantId === obligation.debtorParticipantId &&
      actual.creditorParticipantId === obligation.creditorParticipantId &&
      actual.originalAmount === obligation.originalAmount &&
      actual.voidedAt === null
    );
  });
}

async function voidConfirmedExpense(database: Database, groupId: string, expenseId: string, payerUserId: string, now: Date) {
  const [expense] = await database
    .select()
    .from(groupExpenses)
    .where(
      and(
        eq(groupExpenses.groupId, groupId),
        eq(groupExpenses.id, expenseId),
      ),
    )
    .limit(1)
    .for("update");
  if (!expense) throw new GroupAccountingError("not_found");
  if (expense.state !== "confirmed") throw new GroupAccountingError("invalid_state");
  const payer = await lockActivePayer(database, groupId, expense.payerParticipantId);
  if (payer.userId !== payerUserId) throw new GroupAccountingError("forbidden");
  const shares = await database
    .select()
    .from(groupExpenseShares)
    .where(
      and(
        eq(groupExpenseShares.groupId, groupId),
        eq(groupExpenseShares.expenseId, expenseId),
      ),
    )
    .orderBy(asc(groupExpenseShares.createdAt), asc(groupExpenseShares.id))
    .for("update");
  const obligations = await database
    .select()
    .from(groupObligations)
    .where(
      and(
        eq(groupObligations.groupId, groupId),
        eq(groupObligations.sourceExpenseId, expenseId),
      ),
    )
    .orderBy(asc(groupObligations.id))
    .for("update");
  if (!obligationsMatchExpense(expense, shares, obligations)) throw new GroupAccountingError("financial_integrity");
  const [voided] = await database
    .update(groupExpenses)
    .set({ state: "voided", updatedAt: now })
    .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId), eq(groupExpenses.state, "confirmed")))
    .returning();
  if (!voided) throw new GroupAccountingError("financial_integrity");
  const voidedObligations = await database
    .update(groupObligations)
    .set({ voidedAt: now })
    .where(and(eq(groupObligations.groupId, groupId), eq(groupObligations.sourceExpenseId, expenseId), isNull(groupObligations.voidedAt)))
    .returning({ id: groupObligations.id });
  if (voidedObligations.length !== obligations.length) throw new GroupAccountingError("financial_integrity");
  await appendLifecycleEvent(database, {
    groupId,
    expenseId,
    eventType: "voided",
    actorUserId: payerUserId,
    fromState: "confirmed",
    toState: "voided",
  });
  return { expense: voided, userIds: await activeGroupUserIds(database, groupId) };
}

async function createExpense(database: Database, groupId: string, creatorUserId: string, input: unknown) {
  assertGroupId(groupId);
  assertUserId(creatorUserId);
  const values = normalizeGroupExpenseInput(input);
  try {
    const result = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      await requireGroupAccess(transactionalDatabase, groupId, creatorUserId);
      const { creatorParticipantId, payerUserId } = await lockExpenseEligibility(transactionalDatabase, groupId, creatorUserId, values);
      const now = new Date();
      const [expense] = await transaction
        .insert(groupExpenses)
        .values({
          groupId,
          creatorParticipantId,
          payerParticipantId: values.payerParticipantId,
          description: values.description,
          occurredAt: values.occurredAt,
          totalAmount: values.totalAmount,
          state: "pending",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!expense) throw new Error("Group expense was not created");
      const shares = await transaction
        .insert(groupExpenseShares)
        .values(
          values.shares.map((share) => ({
            groupId,
            expenseId: expense.id,
            participantId: share.participantId,
            amount: share.amount,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning();
      if (shares.length !== values.shares.length) throw new Error("Group expense shares were not created");
      if (creatorParticipantId === values.payerParticipantId) {
        await confirmPendingExpense(transactionalDatabase, groupId, expense.id, values.payerParticipantId, creatorUserId, "created", now);
      } else {
        const [group] = await transactionalDatabase.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).limit(1);
        if (!group) throw new GroupAccountingError("not_found");
        await appendLifecycleEvent(transactionalDatabase, {
          groupId,
          expenseId: expense.id,
          eventType: "created",
          actorUserId: creatorUserId,
          fromState: null,
          toState: "pending",
        });
        await createNotificationInDatabase(transactionalDatabase, {
          recipientUserId: payerUserId,
          type: NOTIFICATION_TYPES.groupExpensePayerClaim,
          metadata: { expenseId: expense.id, groupId, groupName: group.name, description: expense.description },
          dedupeKey: `group-expense-payer-claim:${expense.id}`,
        });
      }
      return {
        expense: await loadExpense(transactionalDatabase, groupId, expense.id),
        userIds: await activeGroupUserIds(transactionalDatabase, groupId),
        notificationUserId:
          creatorParticipantId === values.payerParticipantId ? null : payerUserId,
      };
    });
    publishGroupExpenseFreshness(result.userIds, groupId, result.expense.id, result.expense.state);
    if (result.notificationUserId) publishNotificationStateChange(result.notificationUserId, "created");
    return result.expense;
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

  async function listExpenses(
    viewerUserId: string,
    requestedPage: unknown = 1,
    filters: { q?: unknown; state?: unknown } = {},
  ): Promise<RecordPage<GroupExpenseListRecord>> {
    await authorize(viewerUserId);
    const page = Math.min(normalizePage(requestedPage), 1_000_000);
    const query = normalizeText(filters.q);
    const state = ["pending", "confirmed", "rejected", "voided"].includes(
      filters.state as string,
    )
      ? (filters.state as GroupExpenseRecord["state"])
      : undefined;
    const where = and(
      eq(groupExpenses.groupId, groupId),
      ...(query
        ? [ilike(groupExpenses.description, `%${escapeLikePattern(query)}%`)]
        : []),
      ...(state ? [eq(groupExpenses.state, state)] : []),
    );
    const [{ totalItems }] = await database.select({ totalItems: count() }).from(groupExpenses).where(where);
    const total = Number(totalItems);
    const actualPage = clampPage(page, total);
    const items = await database
      .select({
        ...expenseColumns(),
        shareCount: sql<number>`(select count(*) from group_expense_shares shares where shares.group_id = ${groupId} and shares.expense_id = ${groupExpenses.id})`.mapWith(Number),
      })
      .from(groupExpenses)
      .where(where)
      .orderBy(desc(groupExpenses.occurredAt), desc(groupExpenses.id))
      .limit(RECORD_PAGE_SIZE)
      .offset((actualPage - 1) * RECORD_PAGE_SIZE);
    const participantMap = await loadParticipantMap(database, groupId, items.map((item) => item.payerParticipantId));
    return pageResult(
      items.map((item) => ({
        ...item,
        shareCount: Number(item.shareCount),
        payer:
          participantMap.get(item.payerParticipantId) ?? {
            id: item.payerParticipantId,
            userId: null,
            displayName: "Participant",
            label: null,
            status: "former" as const,
          },
      })),
      total,
      actualPage,
    );
  }

  async function getShares(expenseId: string, viewerUserId: string) {
    const expense = await getExpense(expenseId, viewerUserId);
    return expense.shares;
  }

  async function getSourceObligations(expenseId: string, viewerUserId: string) {
    const expense = await getExpense(expenseId, viewerUserId);
    return expense.obligations;
  }

  async function getLifecycleEvents(expenseId: string, viewerUserId: string) {
    const expense = await getExpense(expenseId, viewerUserId);
    return expense.lifecycleEvents;
  }

  async function getParticipantEligibility(viewerUserId: string): Promise<GroupParticipantEligibility[]> {
    await authorize(viewerUserId);
    const rows = await database
      .select({
        id: groupParticipants.id,
        userId: groupParticipants.userId,
        externalName: groupParticipants.displayName,
        label: groupParticipants.label,
        userName: users.name,
        membershipUserId: groupMemberships.userId,
      })
      .from(groupParticipants)
      .leftJoin(users, eq(users.id, groupParticipants.userId))
      .leftJoin(
        groupMemberships,
        and(
          eq(groupMemberships.groupId, groupParticipants.groupId),
          eq(groupMemberships.participantId, groupParticipants.id),
        ),
      )
      .where(eq(groupParticipants.groupId, groupId))
      .orderBy(asc(groupParticipants.userId), asc(groupParticipants.displayName), asc(groupParticipants.id));
    return rows.map((row) => {
      const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
      return {
        id: row.id,
        userId: row.userId,
        displayName: row.userName ?? row.externalName ?? "Participant",
        label: row.label,
        status,
        canCreate: status === "active",
        canPay: status === "active",
        canParticipate: status !== "former",
        canBeCreditor: status === "active",
      };
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
        const [expense] = await transactionalDatabase
          .select()
          .from(groupExpenses)
          .where(
            and(
              eq(groupExpenses.groupId, groupId),
              eq(groupExpenses.id, expenseId),
            ),
          )
          .limit(1)
          .for("update");
        if (!expense) throw new GroupAccountingError("not_found");
        const payer = await lockActivePayerForExpense(transactionalDatabase, groupId, expense, payerUserId);
        const result = await confirmPendingExpense(transactionalDatabase, groupId, expenseId, payer.id, payerUserId, "payer_confirmed", new Date());
        if (result.changed) await resolvePayerClaimNotification(transactionalDatabase, expenseId, payerUserId, result.expense.updatedAt);
        return {
          expense: await loadExpense(transactionalDatabase, groupId, expenseId),
          changed: result.changed,
          userIds: await activeGroupUserIds(transactionalDatabase, groupId),
        };
      }).catch((error) => {
        if (error instanceof GroupError) mapGroupError(error);
        throw error;
      }).then((result) => {
        publishGroupExpenseFreshness(result.userIds, groupId, result.expense.id, result.expense.state);
        if (result.changed) publishNotificationStateChange(payerUserId, "resolved");
        return result.expense;
      });
    },
    rejectExpenseAsPayer: async (expenseId: string, payerUserId: string) => {
      if (!normalizeUuid(expenseId)) throw new GroupAccountingError("not_found");
      assertUserId(payerUserId);
      const result = await database.transaction(async (transaction) => {
        const transactionalDatabase = transaction as Database;
        await requireGroupAccess(transactionalDatabase, groupId, payerUserId);
        const [expense] = await transactionalDatabase
          .select()
          .from(groupExpenses)
          .where(
            and(
              eq(groupExpenses.groupId, groupId),
              eq(groupExpenses.id, expenseId),
            ),
          )
          .limit(1)
          .for("update");
        if (!expense) throw new GroupAccountingError("not_found");
        const payer = await lockActivePayer(transactionalDatabase, groupId, expense.payerParticipantId);
        if (payer.userId !== payerUserId) throw new GroupAccountingError("forbidden");
        const rejected = await rejectPendingExpense(transactionalDatabase, groupId, expenseId, payer.id, payerUserId, new Date());
        return {
          expense: await loadExpense(transactionalDatabase, groupId, expenseId),
          changed: rejected.changed,
          userIds: await activeGroupUserIds(transactionalDatabase, groupId),
        };
      }).catch((error) => {
        if (error instanceof GroupError) mapGroupError(error);
        throw error;
      });
      publishGroupExpenseFreshness(result.userIds, groupId, result.expense.id, result.expense.state);
      if (result.changed) publishNotificationStateChange(payerUserId, "resolved");
      return result.expense;
    },
    voidExpenseAsPayer: async (expenseId: string, payerUserId: string) => {
      if (!normalizeUuid(expenseId)) throw new GroupAccountingError("not_found");
      assertUserId(payerUserId);
      const result = await database.transaction(async (transaction) => {
        const transactionalDatabase = transaction as Database;
        const voided = await voidConfirmedExpense(transactionalDatabase, groupId, expenseId, payerUserId, new Date());
        return { expense: await loadExpense(transactionalDatabase, groupId, expenseId), userIds: voided.userIds };
      }).catch((error) => {
        if (error instanceof GroupError) mapGroupError(error);
        throw error;
      });
      publishGroupExpenseFreshness(result.userIds, groupId, result.expense.id, result.expense.state);
      return result.expense;
    },
    getExpense,
    listExpenses,
    getShares,
    getSourceObligations,
    getLifecycleEvents,
    getParticipantEligibility,
    getBalances: async (viewerUserId: string) => {
      await authorize(viewerUserId);
      return readGroupBalances(database, groupId);
    },
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

export async function rejectGroupExpenseAsPayer(database: Database, groupId: string, expenseId: string, payerUserId: string) {
  return createGroupAccountingRepository(database, groupId).rejectExpenseAsPayer(expenseId, payerUserId);
}

export async function rejectGroupExpenseAsCurrentUser(groupId: string, expenseId: string) {
  const session = await requireSession();
  return rejectGroupExpenseAsPayer(getDatabase(), groupId, expenseId, session.user.id);
}

export async function voidGroupExpenseAsPayer(database: Database, groupId: string, expenseId: string, payerUserId: string) {
  return createGroupAccountingRepository(database, groupId).voidExpenseAsPayer(expenseId, payerUserId);
}

export async function voidGroupExpenseAsCurrentUser(groupId: string, expenseId: string) {
  const session = await requireSession();
  return voidGroupExpenseAsPayer(getDatabase(), groupId, expenseId, session.user.id);
}
