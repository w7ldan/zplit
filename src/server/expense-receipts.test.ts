import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./ledger-scopes", () => ({ getPersonalLedgerScopeId: vi.fn().mockResolvedValue("owner-a") }));

const {
  createExpenseReceipt,
  deleteExpenseReceipt,
  ExpenseReceiptCountError,
  ExpenseReceiptDuplicateError,
  ExpenseReceiptTotalSizeError,
  ExpenseReceiptUnavailableError,
  getExpenseReceipt,
  listExpenseReceipts,
} = await import("./expense-receipts");

const file = {
  originalFilename: "receipt.png",
  mediaType: "image/png" as const,
  byteSize: 8,
  sha256: "a".repeat(64),
  content: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

function query(rows: unknown[], log: string[], name: string) {
  const result = {
    from() { return result; },
    where() { return result; },
    limit() { return result; },
    orderBy() { return result; },
    for(lock: string) { log.push(`${name}:${lock}`); return Promise.resolve(rows); },
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  };
  return result;
}

function databaseFor(selectRows: unknown[], returningRows: unknown[] = []) {
  const lockLog: string[] = [];
  let selectIndex = 0;
  const transaction = {
    select: vi.fn(() => query(selectRows[selectIndex++] as unknown[] ?? [], lockLog, selectIndex === 1 ? "expense" : "receipts")),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })),
  };
  const database = {
    select: vi.fn(() => query(selectRows[selectIndex++] as unknown[] ?? [], lockLog, "list")),
    transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    delete: transaction.delete,
  };
  return { database: database as never, transaction, lockLog };
}

describe("expense receipt service", () => {
  it("lists safe metadata and retrieves bytes only for the requested owner receipt", async () => {
    const listed = [{ id: "receipt-a", originalFilename: "a.png", mediaType: "image/png", byteSize: 8, createdAt: new Date() }];
    const listDb = databaseFor([listed]);
    await expect(listExpenseReceipts(listDb.database, "owner-a", "expense-a")).resolves.toEqual(listed);
    expect((listDb.database as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledOnce();

    const receipt = { id: "receipt-a", mediaType: "image/png", byteSize: 8, content: Buffer.from(file.content) };
    const getDb = databaseFor([[receipt]]);
    await expect(getExpenseReceipt(getDb.database, "owner-a", "expense-a", "receipt-a")).resolves.toEqual(receipt);
  });

  it("locks the expense and receipts in stable order before enforcing limits and inserting safe metadata", async () => {
    const created = { id: "receipt-a", originalFilename: file.originalFilename, mediaType: file.mediaType, byteSize: file.byteSize, createdAt: new Date() };
    const db = databaseFor([[{ id: "expense-a" }], [{ id: "receipt-z", byteSize: 3, sha256: "b".repeat(64) }]], [created]);
    await expect(createExpenseReceipt(db.database, "owner-a", "expense-a", file)).resolves.toEqual(created);
    expect(db.lockLog).toEqual(["expense:update", "receipts:update"]);
    expect(db.transaction.insert).toHaveBeenCalledOnce();
    const inserted = db.transaction.insert.mock.results[0]?.value;
    expect(inserted.values.mock.calls[0]?.[0]).toHaveProperty("content");
  });

  it("maps missing/foreign expenses and count, total, and duplicate limits", async () => {
    const missing = databaseFor([[]]);
    await expect(createExpenseReceipt(missing.database, "owner-b", "expense-a", file)).rejects.toBeInstanceOf(ExpenseReceiptUnavailableError);

    const count = databaseFor([[{ id: "expense-a" }], Array.from({ length: 5 }, (_, index) => ({ id: String(index), byteSize: 1, sha256: String(index).padStart(64, "0") }))]);
    await expect(createExpenseReceipt(count.database, "owner-a", "expense-a", file)).rejects.toBeInstanceOf(ExpenseReceiptCountError);

    const total = databaseFor([[{ id: "expense-a" }], [{ id: "receipt-a", byteSize: 15 * 1024 * 1024 - 1, sha256: "b".repeat(64) }]]);
    await expect(createExpenseReceipt(total.database, "owner-a", "expense-a", file)).rejects.toBeInstanceOf(ExpenseReceiptTotalSizeError);

    const duplicate = databaseFor([[{ id: "expense-a" }], [{ id: "receipt-a", byteSize: 1, sha256: file.sha256 }]]);
    await expect(createExpenseReceipt(duplicate.database, "owner-a", "expense-a", file)).rejects.toBeInstanceOf(ExpenseReceiptDuplicateError);
  });

  it("deletes only an owner-scoped receipt and reports absence", async () => {
    const db = databaseFor([], [{ id: "receipt-a" }]);
    await expect(deleteExpenseReceipt(db.database, "owner-a", "expense-a", "receipt-a")).resolves.toBe(true);
    const missing = databaseFor([], []);
    await expect(deleteExpenseReceipt(missing.database, "owner-a", "expense-a", "receipt-a")).resolves.toBe(false);
  });
});
