import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  createRepaymentPaymentProof,
  deleteRepaymentPaymentProof,
  getRepaymentPaymentProof,
  getRepaymentPaymentProofMetadata,
  replaceRepaymentPaymentProof,
  RepaymentPaymentProofAlreadyAttachedError,
  RepaymentPaymentProofUnavailableError,
} = await import("./repayment-payment-proofs");

const file = {
  originalFilename: "transfer.png",
  mediaType: "image/png" as const,
  byteSize: 8,
  sha256: "a".repeat(64),
  content: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

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
    const created = { id: "proof-a", originalFilename: file.originalFilename, mediaType: file.mediaType, byteSize: file.byteSize, createdAt: new Date() };
    const add = databaseFor([[{ id: "repayment-a" }], []], [created]);
    await expect(createRepaymentPaymentProof(add.database, "owner-a", "repayment-a", file)).resolves.toEqual(created);
    expect(add.transaction.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner-a", repaymentId: "repayment-a", content: expect.any(Buffer) }));
    expect(add.transaction.insert.mock.results[0]?.value.values.mock.calls[0]?.[0]).not.toHaveProperty("amount");

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
  });
});
