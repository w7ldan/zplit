import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { repaymentProofs, repayments } from "../db/schema";
import { type ValidatedReceiptFile } from "../domain/receipt-file";
import { RECEIPT_READ_HEADERS } from "./expense-receipts";
import { databaseCode } from "./database-error-code";
import { getPersonalLedgerScopeId } from "./ledger-scopes";
import { lockActiveOrganizationForOperationalMutation, OrganizationError, requireLockedOrganizationAccess } from "./organizations";
import { normalizeEvidenceImage } from "./evidence-images";

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

type OrganizationLedgerOwner = { ledgerScopeId: string; organizationId: string };
type AuthorizedOrganizationLedgerOwner = OrganizationLedgerOwner & { userId: string; requiredCapability: "repayments.edit" };
type LedgerOwner = string | OrganizationLedgerOwner;
type MutationOwner = string | AuthorizedOrganizationLedgerOwner;

async function getLedgerScopeId(database: Database, owner: LedgerOwner) {
  if (typeof owner === "string") {
    if (!owner.trim()) throw new Error("A payment proof owner is required");
    return getPersonalLedgerScopeId(database, owner);
  }
  if (!owner.ledgerScopeId?.trim()) throw new Error("A payment proof scope is required");
  return owner.ledgerScopeId;
}

async function lockOwnerOrganizationForMutation(database: Database, owner: MutationOwner) {
  if (typeof owner === "string") return;
  try {
    await lockActiveOrganizationForOperationalMutation(database, owner.organizationId, owner.ledgerScopeId);
    const access = await requireLockedOrganizationAccess(database, owner.organizationId, owner.userId);
    access.require(owner.requiredCapability);
  } catch (error) {
    if (error instanceof OrganizationError && error.code === "archived") throw new RepaymentPaymentProofUnavailableError();
    throw error;
  }
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

export async function getRepaymentPaymentProofMetadata(database: Database, owner: LedgerOwner, repaymentId: string): Promise<RepaymentPaymentProofMetadata | null> {
  const ledgerScopeId = await getLedgerScopeId(database, owner);
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
  owner: MutationOwner,
  repaymentId: string,
  validatedFile: ValidatedReceiptFile,
): Promise<RepaymentPaymentProofMetadata> {
  const ledgerScopeId = await getLedgerScopeId(database, owner);
  try {
    return await database.transaction(async (transaction) => {
      await lockOwnerOrganizationForMutation(transaction as Database, owner);
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

      const normalizedFile = await normalizeEvidenceImage(validatedFile, "Payment proof");

      const [created] = await transaction
        .insert(repaymentProofs)
        .values({
          ledgerScopeId,
          repaymentId,
          originalFilename: normalizedFile.originalFilename,
          mediaType: normalizedFile.mediaType,
          byteSize: normalizedFile.byteSize,
          sha256: normalizedFile.sha256,
          content: Buffer.from(normalizedFile.content),
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
  owner: MutationOwner,
  repaymentId: string,
  validatedFile: ValidatedReceiptFile,
): Promise<RepaymentPaymentProofMetadata> {
  const ledgerScopeId = await getLedgerScopeId(database, owner);
  return database.transaction(async (transaction) => {
    await lockOwnerOrganizationForMutation(transaction as Database, owner);
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
    const normalizedFile = await normalizeEvidenceImage(validatedFile, "Payment proof");
    if (existing) {
      const [replaced] = await transaction
        .update(repaymentProofs)
        .set({
          originalFilename: normalizedFile.originalFilename,
          mediaType: normalizedFile.mediaType,
          byteSize: normalizedFile.byteSize,
          sha256: normalizedFile.sha256,
          content: Buffer.from(normalizedFile.content),
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
        originalFilename: normalizedFile.originalFilename,
        mediaType: normalizedFile.mediaType,
        byteSize: normalizedFile.byteSize,
        sha256: normalizedFile.sha256,
        content: Buffer.from(normalizedFile.content),
      })
      .returning(metadataSelection());
    if (!created) throw new Error("Payment proof was not created");
    return created;
  });
}

export async function getRepaymentPaymentProof(database: Database, owner: LedgerOwner, repaymentId: string, proofId: string): Promise<RepaymentPaymentProofContent | null> {
  const ledgerScopeId = await getLedgerScopeId(database, owner);
  const [proof] = await database
    .select({ id: repaymentProofs.id, mediaType: repaymentProofs.mediaType, byteSize: repaymentProofs.byteSize, content: repaymentProofs.content })
    .from(repaymentProofs)
    .innerJoin(repayments, and(eq(repayments.ledgerScopeId, repaymentProofs.ledgerScopeId), eq(repayments.id, repaymentProofs.repaymentId)))
    .where(and(proofOwnerWhere(ledgerScopeId, repaymentId, proofId), repaymentOwnerWhere(ledgerScopeId, repaymentId)))
    .limit(1);
  return proof ?? null;
}

export async function deleteRepaymentPaymentProof(database: Database, owner: MutationOwner, repaymentId: string, proofId: string) {
  const ledgerScopeId = await getLedgerScopeId(database, owner);
  return database.transaction(async (transaction) => {
    await lockOwnerOrganizationForMutation(transaction as Database, owner);
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
