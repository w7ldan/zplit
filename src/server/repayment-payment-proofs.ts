import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { repaymentProofs, repayments } from "../db/schema";
import { type ValidatedReceiptFile } from "../domain/receipt-file";
import { RECEIPT_READ_HEADERS } from "./expense-receipts";
import { getPersonalLedgerScopeId } from "./ledger-scopes";

export const PAYMENT_PROOF_UNAVAILABLE_MESSAGE = "This repayment or payment proof is no longer available.";
export const PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE = "This repayment already has a payment proof.";
export const PAYMENT_PROOF_READ_HEADERS = RECEIPT_READ_HEADERS;

export type RepaymentPaymentProofMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};

export type RepaymentPaymentProofContent = Pick<RepaymentPaymentProofMetadata, "id" | "mediaType" | "byteSize"> & {
  content: Buffer;
};

export class RepaymentPaymentProofUnavailableError extends Error {
  constructor() {
    super(PAYMENT_PROOF_UNAVAILABLE_MESSAGE);
    this.name = "RepaymentPaymentProofUnavailableError";
  }
}

export class RepaymentPaymentProofAlreadyAttachedError extends Error {
  constructor() {
    super(PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE);
    this.name = "RepaymentPaymentProofAlreadyAttachedError";
  }
}

function metadataSelection() {
  return {
    id: repaymentProofs.id,
    originalFilename: repaymentProofs.originalFilename,
    mediaType: repaymentProofs.mediaType,
    byteSize: repaymentProofs.byteSize,
    createdAt: repaymentProofs.createdAt,
  };
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function assertOwner(ownerUserId: string) {
  if (typeof ownerUserId !== "string" || !ownerUserId.trim()) throw new Error("A payment proof owner is required");
}

function repaymentOwnerWhere(ledgerScopeId: string, repaymentId: string) {
  return and(eq(repayments.ledgerScopeId, ledgerScopeId), eq(repayments.id, repaymentId));
}

function proofOwnerWhere(ledgerScopeId: string, repaymentId: string, proofId?: string) {
  return and(
    eq(repaymentProofs.ledgerScopeId, ledgerScopeId),
    eq(repaymentProofs.repaymentId, repaymentId),
    ...(proofId ? [eq(repaymentProofs.id, proofId)] : []),
  );
}

export async function getRepaymentPaymentProofMetadata(database: Database, ownerUserId: string, repaymentId: string): Promise<RepaymentPaymentProofMetadata | null> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const [proof] = await database
    .select(metadataSelection())
    .from(repaymentProofs)
    .innerJoin(repayments, and(eq(repayments.ledgerScopeId, repaymentProofs.ledgerScopeId), eq(repayments.id, repaymentProofs.repaymentId)))
    .where(and(proofOwnerWhere(ledgerScopeId, repaymentId), repaymentOwnerWhere(ledgerScopeId, repaymentId)))
    .limit(1);
  return proof ?? null;
}

export async function createRepaymentPaymentProof(
  database: Database,
  ownerUserId: string,
  repaymentId: string,
  validatedFile: ValidatedReceiptFile,
): Promise<RepaymentPaymentProofMetadata> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  try {
    return await database.transaction(async (transaction) => {
      const [repayment] = await transaction
        .select({ id: repayments.id })
        .from(repayments)
        .where(repaymentOwnerWhere(ledgerScopeId, repaymentId))
        .limit(1)
        .for("update");
      if (!repayment) throw new RepaymentPaymentProofUnavailableError();

      const [existing] = await transaction
        .select({ id: repaymentProofs.id })
        .from(repaymentProofs)
        .where(proofOwnerWhere(ledgerScopeId, repaymentId))
        .limit(1)
        .for("update");
      if (existing) throw new RepaymentPaymentProofAlreadyAttachedError();

      const [created] = await transaction
        .insert(repaymentProofs)
        .values({
          ledgerScopeId,
          repaymentId,
          originalFilename: validatedFile.originalFilename,
          mediaType: validatedFile.mediaType,
          byteSize: validatedFile.byteSize,
          sha256: validatedFile.sha256,
          content: Buffer.from(validatedFile.content),
        })
        .returning(metadataSelection());
      if (!created) throw new Error("Payment proof was not created");
      return created;
    });
  } catch (error) {
    if (error instanceof RepaymentPaymentProofUnavailableError || error instanceof RepaymentPaymentProofAlreadyAttachedError) throw error;
    if (databaseCode(error) === "23505") throw new RepaymentPaymentProofAlreadyAttachedError();
    throw error;
  }
}

export async function replaceRepaymentPaymentProof(
  database: Database,
  ownerUserId: string,
  repaymentId: string,
  validatedFile: ValidatedReceiptFile,
): Promise<RepaymentPaymentProofMetadata> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  return database.transaction(async (transaction) => {
    const [repayment] = await transaction
      .select({ id: repayments.id })
      .from(repayments)
      .where(repaymentOwnerWhere(ledgerScopeId, repaymentId))
      .limit(1)
      .for("update");
    if (!repayment) throw new RepaymentPaymentProofUnavailableError();

    const [existing] = await transaction
      .select({ id: repaymentProofs.id })
      .from(repaymentProofs)
      .where(proofOwnerWhere(ledgerScopeId, repaymentId))
      .limit(1)
      .for("update");
    if (existing) {
      const [replaced] = await transaction
        .update(repaymentProofs)
        .set({
          originalFilename: validatedFile.originalFilename,
          mediaType: validatedFile.mediaType,
          byteSize: validatedFile.byteSize,
          sha256: validatedFile.sha256,
          content: Buffer.from(validatedFile.content),
        })
        .where(proofOwnerWhere(ledgerScopeId, repaymentId, existing.id))
        .returning(metadataSelection());
      if (!replaced) throw new Error("Payment proof was not replaced");
      return replaced;
    }

    const [created] = await transaction
      .insert(repaymentProofs)
      .values({
        ledgerScopeId,
        repaymentId,
        originalFilename: validatedFile.originalFilename,
        mediaType: validatedFile.mediaType,
        byteSize: validatedFile.byteSize,
        sha256: validatedFile.sha256,
        content: Buffer.from(validatedFile.content),
      })
      .returning(metadataSelection());
    if (!created) throw new Error("Payment proof was not created");
    return created;
  });
}

export async function getRepaymentPaymentProof(database: Database, ownerUserId: string, repaymentId: string, proofId: string): Promise<RepaymentPaymentProofContent | null> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const [proof] = await database
    .select({ id: repaymentProofs.id, mediaType: repaymentProofs.mediaType, byteSize: repaymentProofs.byteSize, content: repaymentProofs.content })
    .from(repaymentProofs)
    .innerJoin(repayments, and(eq(repayments.ledgerScopeId, repaymentProofs.ledgerScopeId), eq(repayments.id, repaymentProofs.repaymentId)))
    .where(and(proofOwnerWhere(ledgerScopeId, repaymentId, proofId), repaymentOwnerWhere(ledgerScopeId, repaymentId)))
    .limit(1);
  return proof ?? null;
}

export async function deleteRepaymentPaymentProof(database: Database, ownerUserId: string, repaymentId: string, proofId: string) {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  return database.transaction(async (transaction) => {
    const [repayment] = await transaction
      .select({ id: repayments.id })
      .from(repayments)
      .where(repaymentOwnerWhere(ledgerScopeId, repaymentId))
      .limit(1)
      .for("update");
    if (!repayment) return false;
    const deleted = await transaction
      .delete(repaymentProofs)
      .where(proofOwnerWhere(ledgerScopeId, repaymentId, proofId))
      .returning({ id: repaymentProofs.id });
    return deleted.length > 0;
  });
}
