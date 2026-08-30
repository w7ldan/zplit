import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { getDatabase, type Database } from "@/db/client";
import {
  groupMemberships,
  groupObligations,
  groupOffsetApplications,
  groupOffsetSettlements,
  groupExpenses,
  groupSettlementApplications,
  groupParticipants,
  groups,
  notifications,
  users,
} from "@/db/schema";
import {
  allocateGroupOffset,
  GROUP_OFFSET_CHANGED_EVENT,
  GroupOffsetAllocationError,
  normalizeGroupOffsetInput,
  offsettableAmount,
  type GroupOffsetAllocationObligation,
  type GroupOffsetSettlementState,
} from "@/domain/group-offsets";
import type { GroupExpenseState } from "@/domain/group-accounting";
import type { GroupOffsetCounterpartyOption } from "@/domain/group-contracts";
import { NOTIFICATION_TYPES } from "@/domain/notifications";
import {
  clampPage,
  normalizePage,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "@/domain/record-retrieval";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { isActiveGroupParticipant, lockGroupFinancialParticipants } from "@/server/group-financial-locks";
import { GroupError, requireGroupAccess } from "@/server/groups";
import { publishRealtimeEvent } from "@/server/realtime";

export class GroupOffsetError extends Error {
  constructor(
    readonly code:
      | "invalid_id"
      | "invalid_user"
      | "not_found"
      | "forbidden"
      | "initiator_not_found"
      | "initiator_external"
      | "initiator_not_active"
      | "counterparty_not_found"
      | "counterparty_external"
      | "counterparty_not_active"
      | "no_capacity"
      | "capacity_changed"
      | "pending_exists"
      | "invalid_state"
      | "financial_integrity",
  ) {
    super(code);
    this.name = "GroupOffsetError";
  }
}

export type GroupOffsetSettlementRecord = typeof groupOffsetSettlements.$inferSelect;
export type GroupOffsetPresentation = GroupOffsetSettlementRecord & {
  initiator: GroupParticipantPresentation;
  counterparty: GroupParticipantPresentation;
};
export type GroupOffsetApplicationPresentation = {
  id: string;
  offsetSettlementId: string;
  obligationId: string;
  appliedAmount: number;
  createdAt: Date;
  sourceExpenseId: string;
  sourceExpenseDescription: string;
  sourceExpenseOccurredAt: Date;
  sourceExpenseState: GroupExpenseState;
  obligationOriginalAmount: number;
  obligationVoidedAt: Date | null;
  debtor: GroupParticipantPresentation;
  creditor: GroupParticipantPresentation;
};
export type GroupOffsetDetail = GroupOffsetPresentation & {
  applications: GroupOffsetApplicationPresentation[];
};
export type GroupParticipantPresentation = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  status: "active" | "former" | "external";
};

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function assertGroupId(groupId: string) {
  if (!normalizeUuid(groupId)) throw new GroupOffsetError("invalid_id");
}

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new GroupOffsetError("invalid_user");
}

function assertOffsetId(offsetId: string) {
  if (!normalizeUuid(offsetId)) throw new GroupOffsetError("not_found");
}

function mapGroupError(error: unknown): never {
  if (error instanceof GroupError) {
    if (error.code === "not_member") throw new GroupOffsetError("forbidden");
    if (error.code === "invalid_id") throw new GroupOffsetError("invalid_id");
    if (error.code === "not_found") throw new GroupOffsetError("not_found");
    if (error.code === "forbidden") throw new GroupOffsetError("forbidden");
  }
  throw error;
}

function fallbackParticipant(id: string): GroupParticipantPresentation {
  return { id, userId: null, displayName: "Participant", label: null, status: "former" };
}

async function loadParticipantMap(database: Database, groupId: string, participantIds: string[]) {
  const ids = [...new Set(participantIds)];
  if (ids.length === 0) return new Map<string, GroupParticipantPresentation>();
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
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, ids)));
  return new Map(rows.map((row) => {
    const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
    return [row.id, {
      id: row.id,
      userId: row.userId,
      displayName: row.userName ?? row.externalName ?? "Participant",
      label: row.label,
      status,
    } satisfies GroupParticipantPresentation];
  }));
}

function offsetColumns() {
  return {
    id: groupOffsetSettlements.id,
    groupId: groupOffsetSettlements.groupId,
    initiatorParticipantId: groupOffsetSettlements.initiatorParticipantId,
    counterpartyParticipantId: groupOffsetSettlements.counterpartyParticipantId,
    amount: groupOffsetSettlements.amount,
    state: groupOffsetSettlements.state,
    createdAt: groupOffsetSettlements.createdAt,
    confirmedAt: groupOffsetSettlements.confirmedAt,
  };
}

function offsetPresentation(
  offset: GroupOffsetSettlementRecord,
  participants: Map<string, GroupParticipantPresentation>,
): GroupOffsetPresentation {
  return {
    ...offset,
    initiator: participants.get(offset.initiatorParticipantId) ?? fallbackParticipant(offset.initiatorParticipantId),
    counterparty: participants.get(offset.counterpartyParticipantId) ?? fallbackParticipant(offset.counterpartyParticipantId),
  };
}

type OffsettableObligation = GroupOffsetAllocationObligation & {
  debtorParticipantId: string;
  creditorParticipantId: string;
};

export async function loadOffsettableObligations(
  database: Database,
  groupId: string,
  participantIds: [string, string],
  at: Date,
  lockRows: boolean,
): Promise<OffsettableObligation[]> {
  const [firstParticipantId, secondParticipantId] = participantIds;
  const query = database
    .select({
      id: groupObligations.id,
      authoritativeAt: groupObligations.createdAt,
      originalAmount: groupObligations.originalAmount,
      debtorParticipantId: groupObligations.debtorParticipantId,
      creditorParticipantId: groupObligations.creditorParticipantId,
    })
    .from(groupObligations)
    .where(and(
      eq(groupObligations.groupId, groupId),
      or(
        and(eq(groupObligations.debtorParticipantId, firstParticipantId), eq(groupObligations.creditorParticipantId, secondParticipantId)),
        and(eq(groupObligations.debtorParticipantId, secondParticipantId), eq(groupObligations.creditorParticipantId, firstParticipantId)),
      ),
      lte(groupObligations.createdAt, at),
      or(isNull(groupObligations.voidedAt), gt(groupObligations.voidedAt, at)),
    ))
    .orderBy(asc(groupObligations.id));
  const obligations = await (lockRows ? query.for("update") : query);
  const obligationIds = obligations.map(({ id }) => id);
  if (obligationIds.length === 0) return [];
  const paymentApplications = await database
    .select({ obligationId: groupSettlementApplications.obligationId, amount: groupSettlementApplications.appliedAmount })
    .from(groupSettlementApplications)
    .where(and(eq(groupSettlementApplications.groupId, groupId), inArray(groupSettlementApplications.obligationId, obligationIds)))
    .orderBy(asc(groupSettlementApplications.obligationId), asc(groupSettlementApplications.id));
  const offsetApplications = await database
    .select({ obligationId: groupOffsetApplications.obligationId, amount: groupOffsetApplications.appliedAmount })
    .from(groupOffsetApplications)
    .where(and(eq(groupOffsetApplications.groupId, groupId), inArray(groupOffsetApplications.obligationId, obligationIds)))
    .orderBy(asc(groupOffsetApplications.obligationId), asc(groupOffsetApplications.id));
  if (lockRows) {
    await database
      .select({ id: groupSettlementApplications.id })
      .from(groupSettlementApplications)
      .where(and(eq(groupSettlementApplications.groupId, groupId), inArray(groupSettlementApplications.obligationId, obligationIds)))
      .orderBy(asc(groupSettlementApplications.obligationId), asc(groupSettlementApplications.id))
      .for("update");
    await database
      .select({ id: groupOffsetApplications.id })
      .from(groupOffsetApplications)
      .where(and(eq(groupOffsetApplications.groupId, groupId), inArray(groupOffsetApplications.obligationId, obligationIds)))
      .orderBy(asc(groupOffsetApplications.obligationId), asc(groupOffsetApplications.id))
      .for("update");
  }
  const paymentsByObligation = new Map<string, number>();
  for (const application of paymentApplications) paymentsByObligation.set(application.obligationId, (paymentsByObligation.get(application.obligationId) ?? 0) + application.amount);
  const offsetsByObligation = new Map<string, number>();
  for (const application of offsetApplications) offsetsByObligation.set(application.obligationId, (offsetsByObligation.get(application.obligationId) ?? 0) + application.amount);
  return obligations.map((obligation) => ({
    ...obligation,
    paymentAppliedAmount: paymentsByObligation.get(obligation.id) ?? 0,
    offsetAppliedAmount: offsetsByObligation.get(obligation.id) ?? 0,
  }));
}

function splitObligations(obligations: OffsettableObligation[], initiatorParticipantId: string, counterpartyParticipantId: string) {
  return {
    initiator: obligations.filter((obligation) => obligation.debtorParticipantId === initiatorParticipantId && obligation.creditorParticipantId === counterpartyParticipantId),
    counterparty: obligations.filter((obligation) => obligation.debtorParticipantId === counterpartyParticipantId && obligation.creditorParticipantId === initiatorParticipantId),
  };
}

async function readOffsetAmount(database: Database, groupId: string, initiatorParticipantId: string, counterpartyParticipantId: string, at = new Date()) {
  const obligations = await loadOffsettableObligations(database, groupId, [initiatorParticipantId, counterpartyParticipantId], at, false);
  const split = splitObligations(obligations, initiatorParticipantId, counterpartyParticipantId);
  return Math.min(offsettableAmount(split.initiator), offsettableAmount(split.counterparty));
}

async function loadOffsetApplications(database: Database, groupId: string, offsetId: string): Promise<GroupOffsetApplicationPresentation[]> {
  const rows = await database
    .select({
      id: groupOffsetApplications.id,
      offsetSettlementId: groupOffsetApplications.offsetSettlementId,
      obligationId: groupOffsetApplications.obligationId,
      appliedAmount: groupOffsetApplications.appliedAmount,
      createdAt: groupOffsetApplications.createdAt,
      sourceExpenseId: groupObligations.sourceExpenseId,
      sourceExpenseDescription: groupExpenses.description,
      sourceExpenseOccurredAt: groupExpenses.occurredAt,
      sourceExpenseState: groupExpenses.state,
      obligationOriginalAmount: groupObligations.originalAmount,
      obligationVoidedAt: groupObligations.voidedAt,
      debtorParticipantId: groupObligations.debtorParticipantId,
      creditorParticipantId: groupObligations.creditorParticipantId,
    })
    .from(groupOffsetApplications)
    .innerJoin(
      groupObligations,
      and(
        eq(groupObligations.groupId, groupOffsetApplications.groupId),
        eq(groupObligations.id, groupOffsetApplications.obligationId),
      ),
    )
    .innerJoin(
      groupExpenses,
      and(
        eq(groupExpenses.groupId, groupObligations.groupId),
        eq(groupExpenses.id, groupObligations.sourceExpenseId),
      ),
    )
    .where(and(eq(groupOffsetApplications.groupId, groupId), eq(groupOffsetApplications.offsetSettlementId, offsetId)))
    .orderBy(asc(groupObligations.createdAt), asc(groupObligations.id), asc(groupOffsetApplications.id));
  const participants = await loadParticipantMap(database, groupId, rows.flatMap((row) => [row.debtorParticipantId, row.creditorParticipantId]));
  return rows.map(({ debtorParticipantId, creditorParticipantId, ...row }) => ({
    ...row,
    sourceExpenseState: row.sourceExpenseState as GroupExpenseState,
    debtor: participants.get(debtorParticipantId) ?? fallbackParticipant(debtorParticipantId),
    creditor: participants.get(creditorParticipantId) ?? fallbackParticipant(creditorParticipantId),
  }));
}

async function loadOffset(database: Database, groupId: string, offsetId: string): Promise<GroupOffsetDetail> {
  const [offset] = await database
    .select(offsetColumns())
    .from(groupOffsetSettlements)
    .where(and(eq(groupOffsetSettlements.groupId, groupId), eq(groupOffsetSettlements.id, offsetId)))
    .limit(1);
  if (!offset) throw new GroupOffsetError("not_found");
  const [participants, applications] = await Promise.all([
    loadParticipantMap(database, groupId, [offset.initiatorParticipantId, offset.counterpartyParticipantId]),
    loadOffsetApplications(database, groupId, offsetId),
  ]);
  return { ...offsetPresentation(offset, participants), applications };
}

async function activeGroupUserIds(database: Database, groupId: string) {
  const rows = await database.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  return rows.map(({ userId }) => userId);
}

function publishGroupOffsetFreshness(userIds: string[], groupId: string, offsetId: string, state: GroupOffsetSettlementState) {
  for (const userId of new Set(userIds)) {
    try {
      void publishRealtimeEvent(userId, {
        type: GROUP_OFFSET_CHANGED_EVENT,
        data: { groupId, offsetId, state },
      }).catch(() => undefined);
    } catch {
      // Realtime is a non-authoritative freshness signal.
    }
  }
}

async function createOffset(database: Database, groupId: string, actorUserId: string, input: unknown) {
  assertGroupId(groupId);
  assertUserId(actorUserId);
  const values = normalizeGroupOffsetInput(input);
  try {
    const result = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      await requireGroupAccess(transactionalDatabase, groupId, actorUserId);
      const [actorMembership] = await transactionalDatabase
        .select({ participantId: groupMemberships.participantId })
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, actorUserId)))
        .limit(1);
      if (!actorMembership) throw new GroupOffsetError("initiator_not_active");
      const locked = await lockGroupFinancialParticipants(transactionalDatabase, groupId, [actorMembership.participantId, values.counterpartyParticipantId]);
      const initiator = locked.participants.get(actorMembership.participantId);
      const counterparty = locked.participants.get(values.counterpartyParticipantId);
      if (!initiator) throw new GroupOffsetError("initiator_not_found");
      if (initiator.userId !== actorUserId) throw new GroupOffsetError("initiator_not_active");
      if (!isActiveGroupParticipant(initiator, locked.memberships.get(initiator.id))) throw new GroupOffsetError("initiator_not_active");
      if (!counterparty) throw new GroupOffsetError("counterparty_not_found");
      if (!counterparty.userId) throw new GroupOffsetError("counterparty_external");
      if (!isActiveGroupParticipant(counterparty, locked.memberships.get(counterparty.id))) throw new GroupOffsetError("counterparty_not_active");
      const [pending] = await transactionalDatabase
        .select({ id: groupOffsetSettlements.id })
        .from(groupOffsetSettlements)
        .where(and(
          eq(groupOffsetSettlements.groupId, groupId),
          eq(groupOffsetSettlements.state, "pending"),
          or(
            and(eq(groupOffsetSettlements.initiatorParticipantId, initiator.id), eq(groupOffsetSettlements.counterpartyParticipantId, counterparty.id)),
            and(eq(groupOffsetSettlements.initiatorParticipantId, counterparty.id), eq(groupOffsetSettlements.counterpartyParticipantId, initiator.id)),
          ),
        ))
        .limit(1);
      if (pending) throw new GroupOffsetError("pending_exists");
      const now = new Date();
      const obligations = await loadOffsettableObligations(transactionalDatabase, groupId, [initiator.id, counterparty.id], now, true);
      const split = splitObligations(obligations, initiator.id, counterparty.id);
      const amount = Math.min(offsettableAmount(split.initiator), offsettableAmount(split.counterparty));
      if (amount < 1) throw new GroupOffsetError("no_capacity");
      const [group] = await transactionalDatabase.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).limit(1);
      if (!group) throw new GroupOffsetError("not_found");
      const [offset] = await transactionalDatabase
        .insert(groupOffsetSettlements)
        .values({
          groupId,
          initiatorParticipantId: initiator.id,
          counterpartyParticipantId: counterparty.id,
          amount,
          state: "pending",
          createdAt: now,
        })
        .returning();
      if (!offset) throw new Error("Group offset was not created");
      const [initiatorUser] = await transactionalDatabase.select({ name: users.name }).from(users).where(eq(users.id, actorUserId)).limit(1);
      await createNotificationInDatabase(transactionalDatabase, {
        recipientUserId: counterparty.userId,
        type: NOTIFICATION_TYPES.groupOffsetConfirmation,
        metadata: {
          offsetId: offset.id,
          groupId,
          groupName: group.name,
          initiatorParticipantId: initiator.id,
          initiatorDisplayName: initiatorUser?.name ?? initiator.displayName ?? "Participant",
        },
        dedupeKey: `group-offset-confirmation:${offset.id}`,
      });
      return {
        offsetId: offset.id,
        recipientUserId: counterparty.userId,
        userIds: await activeGroupUserIds(transactionalDatabase, groupId),
      };
    });
    const created = await loadOffset(database, groupId, result.offsetId);
    publishGroupOffsetFreshness(result.userIds, groupId, result.offsetId, "pending");
    publishNotificationStateChange(result.recipientUserId, "created");
    return created;
  } catch (error) {
    if (error instanceof GroupError) mapGroupError(error);
    if (error instanceof GroupOffsetError) throw error;
    if (databaseCode(error) === "23505") throw new GroupOffsetError("pending_exists");
    if (databaseCode(error) === "23514" || databaseCode(error) === "P0001") throw new GroupOffsetError("financial_integrity");
    throw error;
  }
}

async function confirmOffset(database: Database, groupId: string, offsetId: string, actorUserId: string) {
  assertGroupId(groupId);
  assertOffsetId(offsetId);
  assertUserId(actorUserId);
  try {
    const result = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      const [offset] = await transactionalDatabase
        .select()
        .from(groupOffsetSettlements)
        .where(and(eq(groupOffsetSettlements.groupId, groupId), eq(groupOffsetSettlements.id, offsetId)))
        .limit(1)
        .for("update");
      if (!offset) throw new GroupOffsetError("not_found");
      const locked = await lockGroupFinancialParticipants(transactionalDatabase, groupId, [offset.initiatorParticipantId, offset.counterpartyParticipantId]);
      const initiator = locked.participants.get(offset.initiatorParticipantId);
      const counterparty = locked.participants.get(offset.counterpartyParticipantId);
      if (!counterparty) throw new GroupOffsetError("counterparty_not_found");
      if (counterparty.userId !== actorUserId) throw new GroupOffsetError("forbidden");
      if (!isActiveGroupParticipant(counterparty, locked.memberships.get(counterparty.id))) throw new GroupOffsetError("counterparty_not_active");
      if (!initiator) throw new GroupOffsetError("initiator_not_found");
      if (!isActiveGroupParticipant(initiator, locked.memberships.get(initiator.id))) throw new GroupOffsetError("initiator_not_active");
      if (offset.state === "confirmed") return { changed: false, notificationUserId: null, userIds: await activeGroupUserIds(transactionalDatabase, groupId) };
      if (offset.state !== "pending") throw new GroupOffsetError("invalid_state");
      const now = new Date();
      const obligations = await loadOffsettableObligations(transactionalDatabase, groupId, [initiator.id, counterparty.id], now, true);
      const split = splitObligations(obligations, initiator.id, counterparty.id);
      let initiatorAllocations;
      let counterpartyAllocations;
      try {
        initiatorAllocations = allocateGroupOffset(offset.amount, split.initiator);
        counterpartyAllocations = allocateGroupOffset(offset.amount, split.counterparty);
      } catch (error) {
        if (error instanceof GroupOffsetAllocationError) throw new GroupOffsetError("capacity_changed");
        throw error;
      }
      const [confirmed] = await transactionalDatabase
        .update(groupOffsetSettlements)
        .set({ state: "confirmed", confirmedAt: now })
        .where(and(eq(groupOffsetSettlements.groupId, groupId), eq(groupOffsetSettlements.id, offsetId), eq(groupOffsetSettlements.state, "pending")))
        .returning();
      if (!confirmed) throw new GroupOffsetError("financial_integrity");
      await transactionalDatabase.insert(groupOffsetApplications).values([...initiatorAllocations, ...counterpartyAllocations].map((allocation) => ({
        groupId,
        offsetSettlementId: offsetId,
        obligationId: allocation.obligationId,
        appliedAmount: allocation.amount,
        createdAt: now,
      })));
      await transactionalDatabase
        .update(notifications)
        .set({ readAt: now })
        .where(and(
          eq(notifications.recipientUserId, actorUserId),
          eq(notifications.type, NOTIFICATION_TYPES.groupOffsetConfirmation),
          eq(notifications.dedupeKey, `group-offset-confirmation:${offsetId}`),
        ));
      if (initiator?.userId && initiator.userId !== actorUserId) {
        await createNotificationInDatabase(transactionalDatabase, {
          recipientUserId: initiator.userId,
          type: NOTIFICATION_TYPES.groupOffsetOutcome,
          metadata: { offsetId, groupId, status: "confirmed" },
          dedupeKey: `group-offset-outcome:${offsetId}:confirmed`,
        });
      }
      return { changed: true, notificationUserId: initiator?.userId ?? null, userIds: await activeGroupUserIds(transactionalDatabase, groupId) };
    });
    const confirmed = await loadOffset(database, groupId, offsetId);
    if (result.changed) publishGroupOffsetFreshness(result.userIds, groupId, offsetId, confirmed.state);
    if (result.changed) publishNotificationStateChange(actorUserId, "resolved");
    if (result.changed && result.notificationUserId) publishNotificationStateChange(result.notificationUserId, "created");
    return confirmed;
  } catch (error) {
    if (error instanceof GroupOffsetAllocationError) throw new GroupOffsetError("financial_integrity");
    if (error instanceof GroupOffsetError) throw error;
    if (databaseCode(error) === "23514" || databaseCode(error) === "P0001") throw new GroupOffsetError("financial_integrity");
    throw error;
  }
}

export function createGroupOffsetRepository(database: Database, groupId: string) {
  assertGroupId(groupId);

  async function authorize(userId: string) {
    assertUserId(userId);
    try {
      await requireGroupAccess(database, groupId, userId);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async function getOffset(offsetId: string, viewerUserId: string) {
    assertOffsetId(offsetId);
    await authorize(viewerUserId);
    return loadOffset(database, groupId, offsetId);
  }

  async function listOffsets(viewerUserId: string, requestedPage: unknown = 1): Promise<RecordPage<GroupOffsetPresentation>> {
    await authorize(viewerUserId);
    const [{ totalItems }] = await database.select({ totalItems: count() }).from(groupOffsetSettlements).where(eq(groupOffsetSettlements.groupId, groupId));
    const total = Number(totalItems);
    const actualPage = clampPage(Math.min(normalizePage(requestedPage), 1_000_000), total);
    const rows = await database
      .select(offsetColumns())
      .from(groupOffsetSettlements)
      .where(eq(groupOffsetSettlements.groupId, groupId))
      .orderBy(desc(groupOffsetSettlements.createdAt), desc(groupOffsetSettlements.id))
      .limit(RECORD_PAGE_SIZE)
      .offset((actualPage - 1) * RECORD_PAGE_SIZE);
    const participants = await loadParticipantMap(database, groupId, rows.flatMap((row) => [row.initiatorParticipantId, row.counterpartyParticipantId]));
    return pageResult(rows.map((row) => offsetPresentation(row, participants)), total, actualPage);
  }

  async function getAvailableCounterparties(viewerUserId: string): Promise<GroupOffsetCounterpartyOption[]> {
    await authorize(viewerUserId);
    const [membership] = await database
      .select({ participantId: groupMemberships.participantId })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, viewerUserId)))
      .limit(1);
    if (!membership) return [];
    const rows = await database
      .select({ id: groupParticipants.id, label: groupParticipants.label, externalName: groupParticipants.displayName, userName: users.name })
      .from(groupParticipants)
      .innerJoin(groupMemberships, and(
        eq(groupMemberships.groupId, groupParticipants.groupId),
        eq(groupMemberships.participantId, groupParticipants.id),
        eq(groupMemberships.userId, groupParticipants.userId),
      ))
      .leftJoin(users, eq(users.id, groupParticipants.userId))
      .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.userId, groupMemberships.userId)))
      .orderBy(asc(groupParticipants.id));
    const options = [];
    for (const row of rows) {
      if (row.id === membership.participantId) continue;
      const amount = await readOffsetAmount(database, groupId, membership.participantId, row.id);
      if (amount > 0) options.push({ id: row.id, displayName: row.userName ?? row.externalName ?? "Group member", label: row.label, offsetAmount: amount });
    }
    return options;
  }

  return {
    createOffset: (actorUserId: string, input: unknown) => createOffset(database, groupId, actorUserId, input),
    confirmOffset: (offsetId: string, actorUserId: string) => confirmOffset(database, groupId, offsetId, actorUserId),
    getOffset,
    listOffsets,
    getAvailableCounterparties,
  };
}

export async function createGroupOffset(database: Database, groupId: string, actorUserId: string, input: unknown) {
  return createGroupOffsetRepository(database, groupId).createOffset(actorUserId, input);
}

export async function createGroupOffsetForCurrentUser(groupId: string, input: unknown) {
  const session = await requireSession();
  return createGroupOffset(getDatabase(), groupId, session.user.id, input);
}

export async function confirmGroupOffset(database: Database, groupId: string, offsetId: string, actorUserId: string) {
  return createGroupOffsetRepository(database, groupId).confirmOffset(offsetId, actorUserId);
}

export async function confirmGroupOffsetAsCurrentUser(groupId: string, offsetId: string) {
  const session = await requireSession();
  return confirmGroupOffset(getDatabase(), groupId, offsetId, session.user.id);
}

export async function getGroupOffset(database: Database, groupId: string, offsetId: string, viewerUserId: string) {
  return createGroupOffsetRepository(database, groupId).getOffset(offsetId, viewerUserId);
}

export async function listGroupOffsets(database: Database, groupId: string, viewerUserId: string, requestedPage: unknown = 1) {
  return createGroupOffsetRepository(database, groupId).listOffsets(viewerUserId, requestedPage);
}
