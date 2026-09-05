import "server-only";

import {
  loadAvailableGroupObligations,
  loadOffsetApplications,
  writeOffsetApplications,
  splitObligations,
  resolveOffsetApplications,
  type GroupOffsetApplicationPresentation,
} from "@/server/group-obligation-applications";

import {
  fallbackParticipant,
  loadParticipantMap,
  listActiveGroupUserIds,
  type GroupParticipantPresentation,
  listActiveRegisteredGroupParticipants,
} from "@/server/group-participant-presentation";

import { databaseCode } from "@/server/database-error-code";

import { and, count, desc, eq, or } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { getDatabase, type Database } from "@/db/client";
import {
  groupMemberships,
  groupOffsetSettlements,
  groups,
  notifications,
  users,
} from "@/db/schema";
import {
  GROUP_OFFSET_CHANGED_EVENT,
  GroupOffsetAllocationError,
  normalizeGroupOffsetInput,
  offsettableAmount,
  type GroupOffsetSettlementState,
} from "@/domain/group-offsets";
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

export type GroupOffsetDetail = GroupOffsetPresentation & {
  applications: GroupOffsetApplicationPresentation[];
};

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

async function readOffsetAmount(database: Database, groupId: string, initiatorParticipantId: string, counterpartyParticipantId: string, at = new Date()) {
  const obligations = await loadAvailableGroupObligations(database, groupId, [initiatorParticipantId, counterpartyParticipantId], at, false);
  const split = splitObligations(obligations, initiatorParticipantId, counterpartyParticipantId);
  return Math.min(offsettableAmount(split.initiator), offsettableAmount(split.counterparty));
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
      const obligations = await loadAvailableGroupObligations(transactionalDatabase, groupId, [initiator.id, counterparty.id], now, true);
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
        userIds: await listActiveGroupUserIds(transactionalDatabase, groupId),
      };
    });
    const created = await loadOffset(database, groupId, result.offsetId);
    publishGroupOffsetFreshness(result.userIds, groupId, result.offsetId, "pending");
    publishNotificationStateChange(result.recipientUserId, "created");
    return created;
  } catch (error) {
    if (error instanceof GroupError) mapGroupError(error);
    if (error instanceof GroupOffsetError) throw error;
    if (databaseCode(error, true) === "23505") throw new GroupOffsetError("pending_exists");
    if (databaseCode(error, true) === "23514" || databaseCode(error, true) === "P0001") throw new GroupOffsetError("financial_integrity");
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
      if (offset.state === "confirmed") return { changed: false, notificationUserId: null, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
      if (offset.state !== "pending") throw new GroupOffsetError("invalid_state");
      const now = new Date();
      let allocations;
      try {
        allocations = await resolveOffsetApplications(transactionalDatabase, offset, now);
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
      await writeOffsetApplications(transactionalDatabase, {
        groupId,
        recordId: offsetId,
        allocations,
        createdAt: now,
      });
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
      return { changed: true, notificationUserId: initiator?.userId ?? null, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
    });
    const confirmed = await loadOffset(database, groupId, offsetId);
    if (result.changed) publishGroupOffsetFreshness(result.userIds, groupId, offsetId, confirmed.state);
    if (result.changed) publishNotificationStateChange(actorUserId, "resolved");
    if (result.changed && result.notificationUserId) publishNotificationStateChange(result.notificationUserId, "created");
    return confirmed;
  } catch (error) {
    if (error instanceof GroupOffsetAllocationError) throw new GroupOffsetError("financial_integrity");
    if (error instanceof GroupOffsetError) throw error;
    if (databaseCode(error, true) === "23514" || databaseCode(error, true) === "P0001") throw new GroupOffsetError("financial_integrity");
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
    const rows = await listActiveRegisteredGroupParticipants(database, groupId);
    const options = [];
    for (const row of rows) {
      if (row.id === membership.participantId) continue;
      const amount = await readOffsetAmount(database, groupId, membership.participantId, row.id);
      if (amount > 0) options.push({ id: row.id, displayName: row.displayName, label: row.label, offsetAmount: amount });
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

export type { GroupParticipantPresentation } from "@/server/group-participant-presentation";

export type { GroupOffsetApplicationPresentation } from "@/server/group-obligation-applications";

export { loadAvailableGroupObligations as loadOffsettableObligations } from "@/server/group-obligation-applications";
