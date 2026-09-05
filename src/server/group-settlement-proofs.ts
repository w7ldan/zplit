import "server-only";

import { listActiveGroupUserIds } from "@/server/group-participant-presentation";

import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  groupMemberships,
  groupParticipants,
  groupSettlementProofs,
  groupSettlements,
} from "@/db/schema";
import { MAX_RECEIPT_BYTES, type ValidatedReceiptFile } from "@/domain/receipt-file";
import { normalizeUuid } from "@/domain/record-retrieval";
import {
  publishGroupSettlementFreshness,
} from "@/server/group-settlements";
import { requireGroupAccess } from "@/server/groups";
import { RECEIPT_READ_HEADERS } from "@/server/expense-receipts";

export const GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE = "This Group settlement or payment proof is no longer available.";
export const GROUP_SETTLEMENT_PROOF_ALREADY_ATTACHED_MESSAGE = "This settlement already has a payment proof.";
export const GROUP_SETTLEMENT_PROOF_READ_HEADERS = RECEIPT_READ_HEADERS;

export type GroupSettlementProofMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};

export type GroupSettlementProofContent = Pick<GroupSettlementProofMetadata, "id" | "mediaType" | "byteSize"> & {
  content: Buffer;
};

export class GroupSettlementProofUnavailableError extends Error {
  constructor() {
    super(GROUP_SETTLEMENT_PROOF_UNAVAILABLE_MESSAGE);
    this.name = "GroupSettlementProofUnavailableError";
  }
}

export class GroupSettlementProofPermissionError extends Error {
  constructor() {
    super("Only the settlement sender may change proof while the settlement is pending.");
    this.name = "GroupSettlementProofPermissionError";
  }
}

export class GroupSettlementProofAlreadyAttachedError extends Error {
  constructor() {
    super(GROUP_SETTLEMENT_PROOF_ALREADY_ATTACHED_MESSAGE);
    this.name = "GroupSettlementProofAlreadyAttachedError";
  }
}

function metadataSelection() {
  return {
    id: groupSettlementProofs.id,
    originalFilename: groupSettlementProofs.originalFilename,
    mediaType: groupSettlementProofs.mediaType,
    byteSize: groupSettlementProofs.byteSize,
    createdAt: groupSettlementProofs.createdAt,
  };
}

function assertIds(groupId: string, settlementId: string) {
  if (!normalizeUuid(groupId) || !normalizeUuid(settlementId)) throw new GroupSettlementProofUnavailableError();
}

async function lockPendingSettlementForProof(database: Database, groupId: string, settlementId: string, senderUserId: string) {
  const [candidate] = await database
    .select({ senderParticipantId: groupSettlements.senderParticipantId })
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId)))
    .limit(1);
  if (!candidate) throw new GroupSettlementProofUnavailableError();
  const [participant] = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, candidate.senderParticipantId)))
    .limit(1)
    .for("update");
  const [membership] = await database
    .select({ participantId: groupMemberships.participantId, userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.participantId, candidate.senderParticipantId)))
    .orderBy(asc(groupMemberships.userId))
    .limit(1)
    .for("update");
  const [settlement] = await database
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), eq(groupSettlements.id, settlementId)))
    .limit(1)
    .for("update");
  if (!settlement) throw new GroupSettlementProofUnavailableError();
  if (
    settlement.state !== "pending" ||
    participant?.userId !== senderUserId ||
    membership?.participantId !== settlement.senderParticipantId ||
    membership?.userId !== senderUserId
  ) throw new GroupSettlementProofPermissionError();
  return settlement;
}

async function mutateProof(
  database: Database,
  groupId: string,
  settlementId: string,
  senderUserId: string,
  validatedFile: ValidatedReceiptFile,
  replace: boolean,
) {
  if (validatedFile.byteSize > MAX_RECEIPT_BYTES) throw new RangeError("Settlement proof is too large");
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    await lockPendingSettlementForProof(transactionalDatabase, groupId, settlementId, senderUserId);
    const [existing] = await transactionalDatabase
      .select({ id: groupSettlementProofs.id })
      .from(groupSettlementProofs)
      .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId)))
      .limit(1)
      .for("update");
    if (existing && !replace) throw new GroupSettlementProofAlreadyAttachedError();
    if (existing) {
      const [updated] = await transactionalDatabase
        .update(groupSettlementProofs)
        .set({
          originalFilename: validatedFile.originalFilename,
          mediaType: validatedFile.mediaType,
          byteSize: validatedFile.byteSize,
          sha256: validatedFile.sha256,
          content: Buffer.from(validatedFile.content),
        })
        .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId), eq(groupSettlementProofs.id, existing.id)))
        .returning(metadataSelection());
      if (!updated) throw new Error("Settlement proof was not replaced");
      return { proof: updated, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
    }
    const [created] = await transactionalDatabase
      .insert(groupSettlementProofs)
      .values({
        groupId,
        settlementId,
        originalFilename: validatedFile.originalFilename,
        mediaType: validatedFile.mediaType,
        byteSize: validatedFile.byteSize,
        sha256: validatedFile.sha256,
        content: Buffer.from(validatedFile.content),
      })
      .returning(metadataSelection());
    if (!created) throw new Error("Settlement proof was not created");
    return { proof: created, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
  });
  publishGroupSettlementFreshness(result.userIds, groupId, settlementId, "pending");
  return result.proof;
}

export async function getGroupSettlementProofMetadata(database: Database, groupId: string, settlementId: string, viewerUserId: string) {
  assertIds(groupId, settlementId);
  await requireGroupAccess(database, groupId, viewerUserId);
  const [proof] = await database
    .select(metadataSelection())
    .from(groupSettlementProofs)
    .innerJoin(
      groupSettlements,
      and(eq(groupSettlements.groupId, groupSettlementProofs.groupId), eq(groupSettlements.id, groupSettlementProofs.settlementId)),
    )
    .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId)))
    .limit(1);
  return proof ?? null;
}

export async function createGroupSettlementProof(database: Database, groupId: string, settlementId: string, senderUserId: string, validatedFile: ValidatedReceiptFile) {
  assertIds(groupId, settlementId);
  return mutateProof(database, groupId, settlementId, senderUserId, validatedFile, false);
}

export async function replaceGroupSettlementProof(database: Database, groupId: string, settlementId: string, senderUserId: string, validatedFile: ValidatedReceiptFile) {
  assertIds(groupId, settlementId);
  return mutateProof(database, groupId, settlementId, senderUserId, validatedFile, true);
}

export async function deleteGroupSettlementProof(database: Database, groupId: string, settlementId: string, proofId: string, senderUserId: string) {
  assertIds(groupId, settlementId);
  if (!normalizeUuid(proofId)) return false;
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    await lockPendingSettlementForProof(transactionalDatabase, groupId, settlementId, senderUserId);
    const deleted = await transactionalDatabase
      .delete(groupSettlementProofs)
      .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId), eq(groupSettlementProofs.id, proofId)))
      .returning({ id: groupSettlementProofs.id });
    return { deleted: deleted.length > 0, userIds: await listActiveGroupUserIds(transactionalDatabase, groupId) };
  });
  if (result.deleted) publishGroupSettlementFreshness(result.userIds, groupId, settlementId, "pending");
  return result.deleted;
}

export async function getGroupSettlementProof(database: Database, groupId: string, settlementId: string, proofId: string, viewerUserId: string): Promise<GroupSettlementProofContent | null> {
  assertIds(groupId, settlementId);
  if (!normalizeUuid(proofId)) return null;
  await requireGroupAccess(database, groupId, viewerUserId);
  const [proof] = await database
    .select({ id: groupSettlementProofs.id, mediaType: groupSettlementProofs.mediaType, byteSize: groupSettlementProofs.byteSize, content: groupSettlementProofs.content })
    .from(groupSettlementProofs)
    .innerJoin(
      groupSettlements,
      and(eq(groupSettlements.groupId, groupSettlementProofs.groupId), eq(groupSettlements.id, groupSettlementProofs.settlementId)),
    )
    .where(and(eq(groupSettlementProofs.groupId, groupId), eq(groupSettlementProofs.settlementId, settlementId), eq(groupSettlementProofs.id, proofId)))
    .limit(1);
  return proof ?? null;
}
