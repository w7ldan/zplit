import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { getDatabase, type Database } from "@/db/client";
import {
  groupMemberships,
  groupObligations,
  groupExpenses,
  groupParticipants,
  groupSettlementApplications,
  groupSettlementProofs,
  groupSettlements,
  groups,
  notifications,
  users,
} from "@/db/schema";
import {
  allocateGroupSettlement,
  GroupSettlementAllocationError,
  GROUP_SETTLEMENT_CHANGED_EVENT,
  normalizeGroupSettlementInput,
  type GroupSettlementState,
} from "@/domain/group-settlements";
import type { GroupExpenseState } from "@/domain/group-accounting";
import { NOTIFICATION_TYPES } from "@/domain/notifications";
import type { GroupParticipantPresentation } from "@/server/group-accounting";
import { readGroupBalances } from "@/server/group-accounting";
import {
  clampPage,
  normalizePage,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "@/domain/record-retrieval";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { GroupError, requireGroupAccess } from "@/server/groups";
import { publishRealtimeEvent } from "@/server/realtime";

export class GroupSettlementError extends Error {
  constructor(
    readonly code:
      | "invalid_id"
      | "invalid_user"
      | "not_found"
      | "forbidden"
      | "sender_not_found"
      | "sender_external"
      | "sender_not_active"
      | "recipient_not_found"
      | "recipient_external"
      | "recipient_not_active"
      | "debt_exceeded"
      | "invalid_state"
      | "financial_integrity",
  ) {
    super(code);
    this.name = "GroupSettlementError";
  }
}

export type GroupSettlementRecord = typeof groupSettlements.$inferSelect;
export type GroupSettlementProofMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};
export type GroupSettlementPresentation = GroupSettlementRecord & {
  sender: GroupParticipantPresentation;
  recipient: GroupParticipantPresentation;
  proof: GroupSettlementProofMetadata | null;
};
export type GroupSettlementApplicationPresentation = {
  id: string;
  settlementId: string;
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
export type GroupSettlementDetail = GroupSettlementPresentation & {
  applications: GroupSettlementApplicationPresentation[];
};

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function assertGroupId(groupId: string) {
  if (!normalizeUuid(groupId)) throw new GroupSettlementError("invalid_id");
}

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new GroupSettlementError("invalid_user");
}

function assertSettlementId(settlementId: string) {
  if (!normalizeUuid(settlementId)) throw new GroupSettlementError("not_found");
}

function mapGroupError(error: unknown): never {
  if (error instanceof GroupError) {
    if (error.code === "not_member") throw new GroupSettlementError("forbidden");
    if (error.code === "invalid_id") throw new GroupSettlementError("invalid_id");
    if (error.code === "not_found") throw new GroupSettlementError("not_found");
    if (error.code === "forbidden") throw new GroupSettlementError("forbidden");
  }
  throw error;
}

function settlementColumns() {
  return {
    id: groupSettlements.id,
    groupId: groupSettlements.groupId,
    senderParticipantId: groupSettlements.senderParticipantId,
    recipientParticipantId: groupSettlements.recipientParticipantId,
    amount: groupSettlements.amount,
    paymentMethod: groupSettlements.paymentMethod,
    state: groupSettlements.state,
    createdAt: groupSettlements.createdAt,
    confirmedAt: groupSettlements.confirmedAt,
  };
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

function proofSelection() {
  return {
    id: groupSettlementProofs.id,
    originalFilename: groupSettlementProofs.originalFilename,
    mediaType: groupSettlementProofs.mediaType,
    byteSize: groupSettlementProofs.byteSize,
    createdAt: groupSettlementProofs.createdAt,
  };
}

function settlementPresentation(
  settlement: GroupSettlementRecord,
  participants: Map<string, GroupParticipantPresentation>,
  proof: GroupSettlementProofMetadata | null,
): GroupSettlementPresentation {
  return {
    ...settlement,
    sender: participants.get(settlement.senderParticipantId) ?? fallbackParticipant(settlement.senderParticipantId),
    recipient: participants.get(settlement.recipientParticipantId) ?? fallbackParticipant(settlement.recipientParticipantId),
    proof,
  };
}

async function loadSettlementApplications(database: Database, groupId: string, settlementId: string): Promise<GroupSettlementApplicationPresentation[]> {
  const rows = await database
    .select({
      id: groupSettlementApplications.id,
      settlementId: groupSettlementApplications.settlementId,
      obligationId: groupSettlementApplications.obligationId,
      appliedAmount: groupSettlementApplications.appliedAmount,
      createdAt: groupSettlementApplications.createdAt,
      sourceExpenseId: groupObligations.sourceExpenseId,
      sourceExpenseDescription: groupExpenses.description,
      sourceExpenseOccurredAt: groupExpenses.occurredAt,
      sourceExpenseState: groupExpenses.state,
      obligationOriginalAmount: groupObligations.originalAmount,
      obligationVoidedAt: groupObligations.voidedAt,
      debtorParticipantId: groupObligations.debtorParticipantId,
      creditorParticipantId: groupObligations.creditorParticipantId,
    })
    .from(groupSettlementApplications)
    .innerJoin(
      groupObligations,
      and(
        eq(groupObligations.groupId, groupSettlementApplications.groupId),
        eq(groupObligations.id, groupSettlementApplications.obligationId),
      ),
    )
    .innerJoin(
      groupExpenses,
      and(
        eq(groupExpenses.groupId, groupObligations.groupId),
        eq(groupExpenses.id, groupObligations.sourceExpenseId),
      ),
    )
    .where(and(
      eq(groupSettlementApplications.groupId, groupId),
      eq(groupSettlementApplications.settlementId, settlementId),
    ))
    .orderBy(asc(groupObligations.createdAt), asc(groupObligations.id), asc(groupSettlementApplications.id));
  const participants = await loadParticipantMap(
    database,
    groupId,
    rows.flatMap((row) => [row.debtorParticipantId, row.creditorParticipantId]),
  );
  return rows.map(({ debtorParticipantId, creditorParticipantId, ...row }) => ({
    ...row,
    sourceExpenseState: row.sourceExpenseState as GroupExpenseState,
    debtor: participants.get(debtorParticipantId) ?? fallbackParticipant(debtorParticipantId),
    creditor: participants.get(creditorParticipantId) ?? fallbackParticipant(creditorParticipantId),
  }));
}

async function loadSettlement(database: Database, groupId: string, settlementId: string): Promise<GroupSettlementDetail> {
  const [settlement] = await database
    .select(settlementColumns())
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId)))
    .limit(1);
  if (!settlement) throw new GroupSettlementError("not_found");
  const [participants, proof, applications] = await Promise.all([
    loadParticipantMap(database, groupId, [settlement.senderParticipantId, settlement.recipientParticipantId]),
    database
      .select(proofSelection())
      .from(groupSettlementProofs)
      .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId)))
      .limit(1),
    loadSettlementApplications(database, groupId, settlementId),
  ]);
  return {
    ...settlementPresentation(settlement, participants, proof[0] ?? null),
    applications,
  };
}

async function loadSettlementPage(database: Database, groupId: string, settlements: GroupSettlementRecord[]) {
  const participants = await loadParticipantMap(database, groupId, settlements.flatMap((settlement) => [settlement.senderParticipantId, settlement.recipientParticipantId]));
  const settlementIds = settlements.map(({ id }) => id);
  const proofs = settlementIds.length === 0
    ? []
    : await database
      .select({ ...proofSelection(), settlementId: groupSettlementProofs.settlementId })
      .from(groupSettlementProofs)
      .where(and(eq(groupSettlementProofs.groupId, groupId), inArray(groupSettlementProofs.settlementId, settlementIds)));
  const proofsBySettlementId = new Map(proofs.map(({ settlementId, ...proof }) => [settlementId, proof]));
  return settlements.map((settlement) => settlementPresentation(
    settlement,
    participants,
    proofsBySettlementId.get(settlement.id) ?? null,
  ));
}

export async function listActiveGroupUserIds(database: Database, groupId: string) {
  const rows = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, groupId));
  return rows.map(({ userId }) => userId);
}

export function publishGroupSettlementFreshness(
  userIds: string[],
  groupId: string,
  settlementId: string,
  state: GroupSettlementState,
) {
  for (const userId of new Set(userIds)) {
    try {
      void publishRealtimeEvent(userId, {
        type: GROUP_SETTLEMENT_CHANGED_EVENT,
        data: { groupId, settlementId, state },
      }).catch(() => undefined);
    } catch {
      // Realtime is a non-authoritative freshness signal.
    }
  }
}

type LockedParticipant = {
  id: string;
  userId: string | null;
  displayName: string | null;
};

type LockedMembership = {
  participantId: string;
  userId: string;
};

// Participant rows are the shared PostgreSQL lock domain for Group debt changes.
async function lockSettlementParticipants(database: Database, groupId: string, participantIds: string[]) {
  const ids = [...new Set(participantIds)].sort();
  const participants = await database
    .select({
      id: groupParticipants.id,
      userId: groupParticipants.userId,
      displayName: groupParticipants.displayName,
    })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, ids)))
    .orderBy(asc(groupParticipants.id))
    .for("update");
  const memberships = await database
    .select({ participantId: groupMemberships.participantId, userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), inArray(groupMemberships.participantId, ids)))
    .orderBy(asc(groupMemberships.participantId), asc(groupMemberships.userId))
    .for("update");
  return {
    participants: new Map(participants.map((participant) => [participant.id, participant satisfies LockedParticipant])),
    memberships: new Map(memberships.map((membership) => [membership.participantId, membership satisfies LockedMembership])),
  };
}

function isActiveParticipant(participant: LockedParticipant | undefined, membership: LockedMembership | undefined) {
  return Boolean(participant?.userId && membership?.userId === participant.userId);
}

function balanceAmount(balances: Awaited<ReturnType<typeof readGroupBalances>>, debtorParticipantId: string, creditorParticipantId: string) {
  return balances.find((balance) => balance.debtorParticipantId === debtorParticipantId && balance.creditorParticipantId === creditorParticipantId)?.amount ?? 0;
}

async function resolveSettlementApplications(database: Database, settlement: GroupSettlementRecord, confirmedAt: Date) {
  const obligations = await database
    .select({
      id: groupObligations.id,
      authoritativeAt: groupObligations.createdAt,
      originalAmount: groupObligations.originalAmount,
    })
    .from(groupObligations)
    .where(and(
      eq(groupObligations.groupId, settlement.groupId),
      eq(groupObligations.debtorParticipantId, settlement.senderParticipantId),
      eq(groupObligations.creditorParticipantId, settlement.recipientParticipantId),
      lte(groupObligations.createdAt, confirmedAt),
      or(isNull(groupObligations.voidedAt), gt(groupObligations.voidedAt, confirmedAt)),
    ))
    .orderBy(asc(groupObligations.createdAt), asc(groupObligations.id))
    .for("update");
  const obligationIds = obligations.map(({ id }) => id);
  const applications = obligationIds.length
    ? await database
      .select({ obligationId: groupSettlementApplications.obligationId, appliedAmount: groupSettlementApplications.appliedAmount })
      .from(groupSettlementApplications)
      .where(and(
        eq(groupSettlementApplications.groupId, settlement.groupId),
        inArray(groupSettlementApplications.obligationId, obligationIds),
      ))
      .orderBy(asc(groupSettlementApplications.obligationId), asc(groupSettlementApplications.id))
      .for("update")
    : [];
  const appliedByObligation = new Map<string, number>();
  for (const application of applications) {
    appliedByObligation.set(
      application.obligationId,
      (appliedByObligation.get(application.obligationId) ?? 0) + application.appliedAmount,
    );
  }
  return allocateGroupSettlement(settlement.amount, obligations.map((obligation) => ({
    ...obligation,
    appliedAmount: appliedByObligation.get(obligation.id) ?? 0,
  })));
}

async function createSettlement(database: Database, groupId: string, creatorUserId: string, input: unknown) {
  assertGroupId(groupId);
  assertUserId(creatorUserId);
  const values = normalizeGroupSettlementInput(input);
  try {
    const result = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      const locked = await lockSettlementParticipants(transactionalDatabase, groupId, [values.senderParticipantId, values.recipientParticipantId]);
      const sender = locked.participants.get(values.senderParticipantId);
      const recipient = locked.participants.get(values.recipientParticipantId);
      if (!sender) throw new GroupSettlementError("sender_not_found");
      if (sender.userId !== creatorUserId) throw new GroupSettlementError("forbidden");
      if (!sender.userId) throw new GroupSettlementError("sender_external");
      if (!isActiveParticipant(sender, locked.memberships.get(sender.id))) throw new GroupSettlementError("sender_not_active");
      if (!recipient) throw new GroupSettlementError("recipient_not_found");
      if (!recipient.userId) throw new GroupSettlementError("recipient_external");
      if (!isActiveParticipant(recipient, locked.memberships.get(recipient.id))) throw new GroupSettlementError("recipient_not_active");
      if (balanceAmount(await readGroupBalances(transactionalDatabase, groupId), sender.id, recipient.id) < values.amount) {
        throw new GroupSettlementError("debt_exceeded");
      }
      const [group] = await transactionalDatabase.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).limit(1);
      if (!group) throw new GroupSettlementError("not_found");
      const now = new Date();
      const [settlement] = await transactionalDatabase
        .insert(groupSettlements)
        .values({
          groupId,
          senderParticipantId: sender.id,
          recipientParticipantId: recipient.id,
          amount: values.amount,
          paymentMethod: values.paymentMethod,
          state: "pending",
          createdAt: now,
        })
        .returning();
      if (!settlement) throw new Error("Group settlement was not created");
      const [senderUser] = await transactionalDatabase.select({ name: users.name }).from(users).where(eq(users.id, sender.userId)).limit(1);
      await createNotificationInDatabase(transactionalDatabase, {
        recipientUserId: recipient.userId,
        type: NOTIFICATION_TYPES.groupSettlementConfirmation,
        metadata: {
          settlementId: settlement.id,
          groupId,
          groupName: group.name,
          senderParticipantId: sender.id,
          senderDisplayName: senderUser?.name ?? sender.displayName ?? "Participant",
        },
        dedupeKey: `group-settlement-confirmation:${settlement.id}`,
      });
      return {
        settlementId: settlement.id,
        recipientUserId: recipient.userId,
        userIds: await listActiveGroupUserIds(transactionalDatabase, groupId),
      };
    });
    const created = await loadSettlement(database, groupId, result.settlementId);
    publishGroupSettlementFreshness(result.userIds, groupId, result.settlementId, "pending");
    publishNotificationStateChange(result.recipientUserId, "created");
    return created;
  } catch (error) {
    if (error instanceof GroupError) mapGroupError(error);
    if (databaseCode(error) === "23514" || databaseCode(error) === "P0001") throw new GroupSettlementError("financial_integrity");
    throw error;
  }
}

async function confirmSettlement(database: Database, groupId: string, settlementId: string, actorUserId: string) {
  assertGroupId(groupId);
  assertSettlementId(settlementId);
  assertUserId(actorUserId);
  try {
    const result = await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      const [candidate] = await transactionalDatabase
        .select({ senderParticipantId: groupSettlements.senderParticipantId, recipientParticipantId: groupSettlements.recipientParticipantId })
        .from(groupSettlements)
        .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId)))
        .limit(1);
      if (!candidate) throw new GroupSettlementError("not_found");
      const locked = await lockSettlementParticipants(transactionalDatabase, groupId, [candidate.senderParticipantId, candidate.recipientParticipantId]);
      const [settlement] = await transactionalDatabase
        .select()
        .from(groupSettlements)
        .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId)))
        .limit(1)
        .for("update");
      if (!settlement) throw new GroupSettlementError("not_found");
      const recipient = locked.participants.get(settlement.recipientParticipantId);
      if (!recipient) throw new GroupSettlementError("recipient_not_found");
      if (recipient.userId !== actorUserId) throw new GroupSettlementError("forbidden");
      if (!isActiveParticipant(recipient, locked.memberships.get(recipient.id))) throw new GroupSettlementError("recipient_not_active");
      if (settlement.state === "confirmed") {
        return { changed: false, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
      }
      if (settlement.state !== "pending") throw new GroupSettlementError("invalid_state");
      if (balanceAmount(await readGroupBalances(transactionalDatabase, groupId), settlement.senderParticipantId, settlement.recipientParticipantId) < settlement.amount) {
        throw new GroupSettlementError("debt_exceeded");
      }
      const now = new Date();
      const allocations = await resolveSettlementApplications(transactionalDatabase, settlement, now);
      const [confirmed] = await transactionalDatabase
        .update(groupSettlements)
        .set({ state: "confirmed", confirmedAt: now })
        .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId), eq(groupSettlements.state, "pending")))
        .returning();
      if (!confirmed) throw new GroupSettlementError("financial_integrity");
      await transactionalDatabase.insert(groupSettlementApplications).values(allocations.map((allocation) => ({
        groupId,
        settlementId,
        obligationId: allocation.obligationId,
        appliedAmount: allocation.amount,
        createdAt: now,
      })));
      await transactionalDatabase
        .update(notifications)
        .set({ readAt: now })
        .where(and(
          eq(notifications.recipientUserId, actorUserId),
          eq(notifications.type, NOTIFICATION_TYPES.groupSettlementConfirmation),
          eq(notifications.dedupeKey, `group-settlement-confirmation:${settlementId}`),
        ));
      return { changed: true, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
    });
    const confirmed = await loadSettlement(database, groupId, settlementId);
    if (result.changed) publishGroupSettlementFreshness(result.userIds, groupId, settlementId, confirmed.state);
    if (result.changed) publishNotificationStateChange(actorUserId, "resolved");
    return confirmed;
  } catch (error) {
    if (error instanceof GroupSettlementAllocationError) throw new GroupSettlementError("financial_integrity");
    if (databaseCode(error) === "23514" || databaseCode(error) === "P0001") throw new GroupSettlementError("financial_integrity");
    throw error;
  }
}

export function createGroupSettlementRepository(database: Database, groupId: string) {
  assertGroupId(groupId);

  async function authorize(userId: string) {
    assertUserId(userId);
    try {
      await requireGroupAccess(database, groupId, userId);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async function getSettlement(settlementId: string, viewerUserId: string) {
    assertSettlementId(settlementId);
    await authorize(viewerUserId);
    return loadSettlement(database, groupId, settlementId);
  }

  async function listSettlements(viewerUserId: string, requestedPage: unknown = 1): Promise<RecordPage<GroupSettlementPresentation>> {
    await authorize(viewerUserId);
    const [{ totalItems }] = await database.select({ totalItems: count() }).from(groupSettlements).where(eq(groupSettlements.groupId, groupId));
    const total = Number(totalItems);
    const actualPage = clampPage(Math.min(normalizePage(requestedPage), 1_000_000), total);
    const rows = await database
      .select(settlementColumns())
      .from(groupSettlements)
      .where(eq(groupSettlements.groupId, groupId))
      .orderBy(desc(groupSettlements.createdAt), desc(groupSettlements.id))
      .limit(RECORD_PAGE_SIZE)
      .offset((actualPage - 1) * RECORD_PAGE_SIZE);
    return pageResult(await loadSettlementPage(database, groupId, rows), total, actualPage);
  }

  return {
    createSettlement: (creatorUserId: string, input: unknown) => createSettlement(database, groupId, creatorUserId, input),
    confirmSettlement: (settlementId: string, actorUserId: string) => confirmSettlement(database, groupId, settlementId, actorUserId),
    getSettlement,
    listSettlements,
    getBalances: async (viewerUserId: string) => {
      await authorize(viewerUserId);
      return readGroupBalances(database, groupId);
    },
  };
}

export async function createGroupSettlement(database: Database, groupId: string, creatorUserId: string, input: unknown) {
  return createGroupSettlementRepository(database, groupId).createSettlement(creatorUserId, input);
}

export async function createGroupSettlementForCurrentUser(groupId: string, input: unknown) {
  const session = await requireSession();
  return createGroupSettlement(getDatabase(), groupId, session.user.id, input);
}

export async function confirmGroupSettlement(database: Database, groupId: string, settlementId: string, actorUserId: string) {
  return createGroupSettlementRepository(database, groupId).confirmSettlement(settlementId, actorUserId);
}

export async function confirmGroupSettlementAsCurrentUser(groupId: string, settlementId: string) {
  const session = await requireSession();
  return confirmGroupSettlement(getDatabase(), groupId, settlementId, session.user.id);
}

export async function getGroupSettlement(database: Database, groupId: string, settlementId: string, viewerUserId: string) {
  return createGroupSettlementRepository(database, groupId).getSettlement(settlementId, viewerUserId);
}

export async function listGroupSettlements(database: Database, groupId: string, viewerUserId: string, requestedPage: unknown = 1) {
  return createGroupSettlementRepository(database, groupId).listSettlements(viewerUserId, requestedPage);
}

export async function getGroupSettlementBalances(database: Database, groupId: string, viewerUserId: string) {
  return createGroupSettlementRepository(database, groupId).getBalances(viewerUserId);
}
