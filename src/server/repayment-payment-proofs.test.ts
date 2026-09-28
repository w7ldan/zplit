import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createValidatedReceiptImage } from "@/test/receipt-image";

vi.mock("server-only", () => ({}));
vi.mock("./ledger-scopes", () => ({ getPersonalLedgerScopeId: vi.fn().mockResolvedValue("owner-a") }));
const organizationMocks = vi.hoisted(() => {
  class FakeOrganizationError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    FakeOrganizationError,
    lockActiveOrganizationForOperationalMutation: vi.fn(async () => undefined),
    requireLockedOrganizationAccess: vi.fn(async () => ({ require: vi.fn() })),
  };
});
vi.mock("./organizations", () => ({ OrganizationError: organizationMocks.FakeOrganizationError, lockActiveOrganizationForOperationalMutation: organizationMocks.lockActiveOrganizationForOperationalMutation, requireLockedOrganizationAccess: organizationMocks.requireLockedOrganizationAccess }));

const {
  createRepaymentPaymentProof,
  deleteRepaymentPaymentProof,
  getRepaymentPaymentProof,
  getRepaymentPaymentProofMetadata,
  replaceRepaymentPaymentProof,
  RepaymentPaymentProofAlreadyAttachedError,
  RepaymentPaymentProofUnavailableError,
} = await import("./repayment-payment-proofs");

const file = await createValidatedReceiptImage("transfer.png");

function query(rows: unknown[]) {
  const result = {
    from() { return result; },
    innerJoin() { return result; },
    where() { return result; },
    limit() { return result; },
    for() { return Promise.resolve(rows); },
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  };
  return result;
}

function databaseFor(selectRows: unknown[][], returningRows: unknown[] = [], replacementRows: unknown[] = returningRows) {
  let selectIndex = 0;
  const transaction = {
    select: vi.fn(() => query(selectRows[selectIndex++] ?? [])),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => replacementRows) })) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })),
  };
  const database = {
    select: vi.fn(() => query(selectRows[selectIndex++] ?? [])),
    transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { database: database as never, transaction };
}

describe("repayment payment proof service", () => {
  it("adds, reads metadata/content, replaces one row, and removes it owner-scoped", async () => {
    const created = { id: "proof-a", originalFilename: "transfer.webp", mediaType: "image/webp", byteSize: 0, createdAt: new Date() };
    const add = databaseFor([[{ id: "repayment-a" }], []], [created]);
    await expect(createRepaymentPaymentProof(add.database, "owner-a", "repayment-a", file)).resolves.toEqual(created);
    expect(add.transaction.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(expect.objectContaining({ ledgerScopeId: "owner-a", repaymentId: "repayment-a", content: expect.any(Buffer) }));
    const stored = add.transaction.insert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(stored).toMatchObject({ mediaType: "image/webp", originalFilename: "transfer.webp", byteSize: stored.content.byteLength });
    expect((await sharp(stored.content).metadata()).format).toBe("webp");
    expect(stored.content).not.toEqual(Buffer.from(file.content));
    expect(stored).not.toHaveProperty("amount");

    const metadata = databaseFor([[created]]);
    await expect(getRepaymentPaymentProofMetadata(metadata.database, "owner-a", "repayment-a")).resolves.toEqual(created);
    const bytes = Buffer.from(file.content);
    const content = databaseFor([[{ id: "proof-a", mediaType: file.mediaType, byteSize: bytes.length, content: bytes }]]);
    await expect(getRepaymentPaymentProof(content.database, "owner-a", "repayment-a", "proof-a")).resolves.toMatchObject({ content: bytes });

    const replaced = { ...created, originalFilename: "new.png" };
    const replacement = databaseFor([[{ id: "repayment-a" }], [{ id: "proof-a" }]], [created], [replaced]);
    await expect(replaceRepaymentPaymentProof(replacement.database, "owner-a", "repayment-a", { ...file, originalFilename: "new.png" })).resolves.toEqual(replaced);
    expect(replacement.transaction.update).toHaveBeenCalledOnce();
    expect(replacement.transaction.insert).not.toHaveBeenCalled();

    const removal = databaseFor([[{ id: "repayment-a" }]], [{ id: "proof-a" }]);
    await expect(deleteRepaymentPaymentProof(removal.database, "owner-a", "repayment-a", "proof-a")).resolves.toBe(true);
    expect(removal.transaction.delete).toHaveBeenCalledOnce();
  });

  it("keeps missing and foreign repayment/proof operations indistinguishable", async () => {
    const missing = databaseFor([[]]);
    await expect(createRepaymentPaymentProof(missing.database, "owner-b", "repayment-a", file)).rejects.toBeInstanceOf(RepaymentPaymentProofUnavailableError);
    await expect(replaceRepaymentPaymentProof(missing.database, "owner-b", "repayment-a", file)).rejects.toBeInstanceOf(RepaymentPaymentProofUnavailableError);
    await expect(deleteRepaymentPaymentProof(missing.database, "owner-b", "repayment-a", "proof-a")).resolves.toBe(false);

    const foreignRead = databaseFor([[]]);
    await expect(getRepaymentPaymentProofMetadata(foreignRead.database, "owner-b", "repayment-a")).resolves.toBeNull();
    await expect(getRepaymentPaymentProof(foreignRead.database, "owner-b", "repayment-a", "proof-a")).resolves.toBeNull();
  });

  it("rejects a second add while replacement preserves the old row on transaction failure", async () => {
    const existing = databaseFor([[{ id: "repayment-a" }], [{ id: "proof-a" }]]);
    await expect(createRepaymentPaymentProof(existing.database, "owner-a", "repayment-a", file)).rejects.toBeInstanceOf(RepaymentPaymentProofAlreadyAttachedError);
    const failed = databaseFor([[{ id: "repayment-a" }], [{ id: "proof-a" }]]);
    failed.transaction.update.mockImplementation(() => { throw new Error("write failed"); });
    await expect(replaceRepaymentPaymentProof(failed.database, "owner-a", "repayment-a", file)).rejects.toThrow("write failed");

    const invalid = { ...file, content: Uint8Array.from([0xff, 0xd8, 0xff]) };
    const failedNormalization = databaseFor([[{ id: "repayment-a" }], [{ id: "proof-a" }]]);
    await expect(replaceRepaymentPaymentProof(failedNormalization.database, "owner-a", "repayment-a", invalid)).rejects.toThrow("could not be processed");
    expect(failedNormalization.transaction.update).not.toHaveBeenCalled();
    expect(failedNormalization.transaction.insert).not.toHaveBeenCalled();
  });

  it("locks an active Organization for payment proof upload and deletion while archived proof reads remain available", async () => {
    const organizationOwner = { organizationId: "organization-a", ledgerScopeId: "scope-organization", userId: "user-a", requiredCapability: "repayments.edit" as const };
    const created = { id: "proof-a", originalFilename: file.originalFilename, mediaType: file.mediaType, byteSize: file.byteSize, createdAt: new Date() };
    const upload = databaseFor([[{ id: "repayment-a" }], []], [created]);
    await expect(createRepaymentPaymentProof(upload.database, organizationOwner, "repayment-a", file)).resolves.toEqual(created);
    expect(organizationMocks.lockActiveOrganizationForOperationalMutation).toHaveBeenCalledWith(upload.transaction, "organization-a", "scope-organization");
    expect(organizationMocks.requireLockedOrganizationAccess).toHaveBeenCalledWith(upload.transaction, "organization-a", "user-a");
    expect(upload.transaction.insert).toHaveBeenCalledOnce();

    const removal = databaseFor([[{ id: "repayment-a" }]], [{ id: "proof-a" }]);
    await expect(deleteRepaymentPaymentProof(removal.database, organizationOwner, "repayment-a", "proof-a")).resolves.toBe(true);
    expect(organizationMocks.lockActiveOrganizationForOperationalMutation).toHaveBeenLastCalledWith(removal.transaction, "organization-a", "scope-organization");

    const historical = databaseFor([[{ id: "proof-a", mediaType: file.mediaType, byteSize: file.byteSize, content: Buffer.from(file.content) }]]);
    await expect(getRepaymentPaymentProof(historical.database, organizationOwner, "repayment-a", "proof-a")).resolves.toMatchObject({ id: "proof-a" });
    expect(organizationMocks.lockActiveOrganizationForOperationalMutation).toHaveBeenCalledTimes(2);
  });

  it("rejects archived Organization payment proof upload, replacement, and deletion before attachment writes", async () => {
    const organizationOwner = { organizationId: "organization-a", ledgerScopeId: "scope-organization", userId: "user-a", requiredCapability: "repayments.edit" as const };
    const upload = databaseFor([[{ id: "repayment-a" }], []], [{ id: "proof-a" }]);
    organizationMocks.lockActiveOrganizationForOperationalMutation.mockRejectedValueOnce(new organizationMocks.FakeOrganizationError("archived"));
    await expect(createRepaymentPaymentProof(upload.database, organizationOwner, "repayment-a", file)).rejects.toBeInstanceOf(RepaymentPaymentProofUnavailableError);
    expect(upload.transaction.insert).not.toHaveBeenCalled();

    const replacement = databaseFor([[{ id: "repayment-a" }], [{ id: "proof-a" }]], [{ id: "proof-a" }], [{ id: "proof-a" }]);
    organizationMocks.lockActiveOrganizationForOperationalMutation.mockRejectedValueOnce(new organizationMocks.FakeOrganizationError("archived"));
    await expect(replaceRepaymentPaymentProof(replacement.database, organizationOwner, "repayment-a", file)).rejects.toBeInstanceOf(RepaymentPaymentProofUnavailableError);
    expect(replacement.transaction.update).not.toHaveBeenCalled();
    expect(replacement.transaction.insert).not.toHaveBeenCalled();

    const removal = databaseFor([[{ id: "repayment-a" }]], [{ id: "proof-a" }]);
    organizationMocks.lockActiveOrganizationForOperationalMutation.mockRejectedValueOnce(new organizationMocks.FakeOrganizationError("archived"));
    await expect(deleteRepaymentPaymentProof(removal.database, organizationOwner, "repayment-a", "proof-a")).rejects.toBeInstanceOf(RepaymentPaymentProofUnavailableError);
    expect(removal.transaction.delete).not.toHaveBeenCalled();
  });
});
