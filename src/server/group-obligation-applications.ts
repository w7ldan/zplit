import "server-only";

import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  groupExpenses,
  groupObligations,
  groupOffsetApplications,
  groupOffsetSettlements,
  groupSettlementApplications,
  groupSettlements,
} from "@/db/schema";
import type { GroupExpenseState } from "@/domain/group-accounting";
import { allocateGroupOffset, type GroupOffsetAllocationObligation } from "@/domain/group-offsets";
import { allocateGroupSettlement } from "@/domain/group-settlements";
import {
  fallbackParticipant,
  loadParticipantMap,
  type GroupParticipantPresentation,
} from "@/server/group-participant-presentation";

export type ObligationApplicationRow = {
  id: string;
  obligationId: string;
  settlementId: string;
  appliedAmount: number;
  createdAt: Date;
  settlementConfirmedAt: Date | null;
};

type GroupApplicationPresentation = {
  id: string;
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

export type GroupSettlementApplicationPresentation = GroupApplicationPresentation & { settlementId: string };
export type GroupOffsetApplicationPresentation = GroupApplicationPresentation & { offsetSettlementId: string };

export type AvailableGroupObligation = GroupOffsetAllocationObligation & {
  debtorParticipantId: string;
  creditorParticipantId: string;
};

export async function loadAvailableGroupObligations(
  database: Database,
  groupId: string,
  participantIds: [string, string],
  at: Date,
  lockRows: boolean,
): Promise<AvailableGroupObligation[]> {
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
  for (const application of paymentApplications) {
    paymentsByObligation.set(
      application.obligationId,
      (paymentsByObligation.get(application.obligationId) ?? 0) + application.amount,
    );
  }
  const offsetsByObligation = new Map<string, number>();
  for (const application of offsetApplications) {
    offsetsByObligation.set(
      application.obligationId,
      (offsetsByObligation.get(application.obligationId) ?? 0) + application.amount,
    );
  }
  return obligations.map((obligation) => ({
    ...obligation,
    paymentAppliedAmount: paymentsByObligation.get(obligation.id) ?? 0,
    offsetAppliedAmount: offsetsByObligation.get(obligation.id) ?? 0,
  }));
}

export async function loadOffsetApplications(database: Database, groupId: string, offsetId: string): Promise<GroupOffsetApplicationPresentation[]> {
  const rows = await database
    .select({
      id: groupOffsetApplications.id,
      offsetSettlementId: groupOffsetApplications.offsetSettlementId,
      obligationId: groupOffsetApplications.obligationId,
      appliedAmount: groupOffsetApplications.appliedAmount,
      createdAt: groupOffsetApplications.createdAt,
      ...applicationSourceColumns(),
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
  return presentApplicationRows(database, groupId, rows);
}

export async function loadSettlementApplications(database: Database, groupId: string, settlementId: string): Promise<GroupSettlementApplicationPresentation[]> {
  const rows = await database
    .select({
      id: groupSettlementApplications.id,
      settlementId: groupSettlementApplications.settlementId,
      obligationId: groupSettlementApplications.obligationId,
      appliedAmount: groupSettlementApplications.appliedAmount,
      createdAt: groupSettlementApplications.createdAt,
      ...applicationSourceColumns(),
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
  return presentApplicationRows(database, groupId, rows);
}

export async function resolveSettlementApplications(database: Database, settlement: typeof groupSettlements.$inferSelect, confirmedAt: Date) {
  const obligations = await loadAvailableGroupObligations(
    database,
    settlement.groupId,
    [settlement.senderParticipantId, settlement.recipientParticipantId],
    confirmedAt,
    true,
  );
  return allocateGroupSettlement(settlement.amount, obligations
    .filter((obligation) =>
      obligation.debtorParticipantId === settlement.senderParticipantId &&
      obligation.creditorParticipantId === settlement.recipientParticipantId)
    .map((obligation) => ({
      ...obligation,
      appliedAmount: obligation.paymentAppliedAmount + obligation.offsetAppliedAmount,
    })));
}

export async function loadObligationApplicationRows(database: Database, groupId: string, obligationIds: string[]): Promise<ObligationApplicationRow[]> {
  if (obligationIds.length === 0) return [];
  return database
    .select({
      id: groupSettlementApplications.id,
      obligationId: groupSettlementApplications.obligationId,
      settlementId: groupSettlementApplications.settlementId,
      appliedAmount: groupSettlementApplications.appliedAmount,
      createdAt: groupSettlementApplications.createdAt,
      settlementConfirmedAt: groupSettlements.confirmedAt,
    })
    .from(groupSettlementApplications)
    .innerJoin(
      groupSettlements,
      and(
        eq(groupSettlements.groupId, groupSettlementApplications.groupId),
        eq(groupSettlements.id, groupSettlementApplications.settlementId),
      ),
    )
    .where(and(
      eq(groupSettlementApplications.groupId, groupId),
      inArray(groupSettlementApplications.obligationId, obligationIds),
    ))
    .orderBy(
      asc(groupSettlementApplications.obligationId),
      asc(groupSettlements.confirmedAt),
      asc(groupSettlementApplications.id),
    );
}

type ApplicationWrite = {
  groupId: string;
  recordId: string;
  allocations: { obligationId: string; amount: number }[];
  createdAt: Date;
};

function applicationRows(write: ApplicationWrite) {
  return write.allocations.map((allocation) => ({
    groupId: write.groupId,
    obligationId: allocation.obligationId,
    appliedAmount: allocation.amount,
    createdAt: write.createdAt,
  }));
}

// Call within the confirming transaction, after locking participants, obligations,
// and existing payment then offset applications in their deterministic ID order.
export async function writeSettlementApplications(database: Database, write: ApplicationWrite) {
  await database.insert(groupSettlementApplications).values(applicationRows(write).map((row) => ({
    ...row,
    settlementId: write.recordId,
  })));
}

export async function writeOffsetApplications(database: Database, write: ApplicationWrite) {
  await database.insert(groupOffsetApplications).values(applicationRows(write).map((row) => ({
    ...row,
    offsetSettlementId: write.recordId,
  })));
}

function applicationSourceColumns() {
  return {
    sourceExpenseId: groupObligations.sourceExpenseId,
    sourceExpenseDescription: groupExpenses.description,
    sourceExpenseOccurredAt: groupExpenses.occurredAt,
    sourceExpenseState: groupExpenses.state,
    obligationOriginalAmount: groupObligations.originalAmount,
    obligationVoidedAt: groupObligations.voidedAt,
    debtorParticipantId: groupObligations.debtorParticipantId,
    creditorParticipantId: groupObligations.creditorParticipantId,
  };
}

export function splitObligations(obligations: AvailableGroupObligation[], initiatorParticipantId: string, counterpartyParticipantId: string) {
  return {
    initiator: obligations.filter((obligation) =>
      obligation.debtorParticipantId === initiatorParticipantId && obligation.creditorParticipantId === counterpartyParticipantId),
    counterparty: obligations.filter((obligation) =>
      obligation.debtorParticipantId === counterpartyParticipantId && obligation.creditorParticipantId === initiatorParticipantId),
  };
}

export async function resolveOffsetApplications(
  database: Database,
  offset: typeof groupOffsetSettlements.$inferSelect,
  confirmedAt: Date,
) {
  const obligations = await loadAvailableGroupObligations(
    database,
    offset.groupId,
    [offset.initiatorParticipantId, offset.counterpartyParticipantId],
    confirmedAt,
    true,
  );
  const split = splitObligations(obligations, offset.initiatorParticipantId, offset.counterpartyParticipantId);
  return [
    ...allocateGroupOffset(offset.amount, split.initiator),
    ...allocateGroupOffset(offset.amount, split.counterparty),
  ];
}

async function presentApplicationRows<T extends {
  debtorParticipantId: string;
  creditorParticipantId: string;
  sourceExpenseState: string;
}>(database: Database, groupId: string, rows: T[]) {
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
