import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

vi.mock("server-only", () => ({}));

const { createGroupExpenseReceipt, deleteGroupExpenseReceipt, getGroupExpenseReceipt, GroupExpenseReceiptPermissionError, GroupExpenseReceiptUnavailableError } = await import("./group-expense-receipts");

const groupId = "11111111-1111-4111-8111-111111111111";
const expenseId = "22222222-2222-4222-8222-222222222222";
const participantId = "33333333-3333-4333-8333-333333333333";
const receiptId = "44444444-4444-4444-8444-444444444444";
const file = { originalFilename: "receipt.png", mediaType: "image/png" as const, byteSize: 4, sha256: "a".repeat(64), content: Uint8Array.from([1, 2, 3, 4]) };

function query(rows: unknown[], locks: string[], name: string) {
  const result = {
    from() { return result; },
    where() { return result; },
    limit() { return result; },
    orderBy() { return result; },
    for(lock: string) { locks.push(`${name}:${lock}`); return Promise.resolve(rows); },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(rows).then(resolve, reject); },
  };
  return result;
}

function databaseFor(rows: unknown[][], returning: unknown[] = []) {
  const locks: string[] = [];
  let index = 0;
  const select = vi.fn(() => query(rows[index++] ?? [], locks, ["lifecycle", "access", "expense", "participant", "membership", "receipts", "receipt"][index - 1] ?? "select"));
  const transaction = {
    select,
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => returning) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => returning) })) })),
  };
  const database = {
    select,
    transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { database: database as unknown as Database, transaction, locks };
}

function authorizedRows(receipts: unknown[] = []) {
  return [
    [{ role: "member" }],
    [{ id: expenseId, state: "pending", creatorParticipantId: participantId }],
    [{ userId: "user-b" }],
    [{ userId: "user-b", participantId }],
    receipts,
  ];
}

describe("Group expense receipt service", () => {
  it("locks expense, creator participant, membership, and receipts in the compatible order", async () => {
    const created = { id: receiptId, originalFilename: file.originalFilename, mediaType: file.mediaType, byteSize: file.byteSize, createdAt: new Date() };
    const database = databaseFor([[{ id: groupId, archivedAt: null }], ...authorizedRows()], [created]);

    await expect(createGroupExpenseReceipt(database.database, groupId, expenseId, "user-b", file)).resolves.toEqual(created);
    expect(database.locks).toEqual(["expense:update", "participant:update", "membership:update", "receipts:update"]);
    expect(database.transaction.insert).toHaveBeenCalledOnce();
  });

  it("rejects stale or non-creator authorization before a receipt mutation", async () => {
    const staleMembership = databaseFor([[{ id: groupId, archivedAt: null }], ...authorizedRows().slice(0, 3), []], [{ id: receiptId }]);
    await expect(createGroupExpenseReceipt(staleMembership.database, groupId, expenseId, "user-b", file)).rejects.toBeInstanceOf(GroupExpenseReceiptPermissionError);
    expect(staleMembership.transaction.insert).not.toHaveBeenCalled();

    const nonCreator = databaseFor([
      [{ role: "member" }],
      [{ id: expenseId, state: "pending", creatorParticipantId: participantId }],
      [{ userId: "user-a" }],
      [{ userId: "user-a", participantId }],
    ], [{ id: receiptId }]);
    await expect(deleteGroupExpenseReceipt(nonCreator.database, groupId, expenseId, receiptId, "user-b")).rejects.toBeInstanceOf(GroupExpenseReceiptPermissionError);
    expect(nonCreator.transaction.delete).not.toHaveBeenCalled();

    const former = databaseFor([[]]);
    await expect(createGroupExpenseReceipt(former.database, groupId, expenseId, "user-b", file)).rejects.toBeInstanceOf(GroupExpenseReceiptUnavailableError);
  });

  it("keeps reads Group- and expense-scoped", async () => {
    const database = databaseFor([
      [{ role: "member" }],
      [{ id: expenseId, state: "pending", creatorParticipantId: participantId }],
      [],
    ]);

    await expect(getGroupExpenseReceipt(database.database, groupId, expenseId, receiptId, "user-b")).resolves.toBeNull();
  });
});
