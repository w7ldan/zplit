import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createValidatedReceiptImage } from "@/test/receipt-image";

const groupMocks = vi.hoisted(() => ({
  lockActiveGroupForOperationalMutation: vi.fn(async () => undefined),
  listActiveGroupUserIds: vi.fn(async () => ["user-a"]),
  publishGroupSettlementFreshness: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/groups", () => ({ lockActiveGroupForOperationalMutation: groupMocks.lockActiveGroupForOperationalMutation, requireGroupAccess: vi.fn() }));
vi.mock("@/server/group-participant-presentation", () => ({ listActiveGroupUserIds: groupMocks.listActiveGroupUserIds }));
vi.mock("@/server/group-settlements", () => ({ publishGroupSettlementFreshness: groupMocks.publishGroupSettlementFreshness }));

const { createGroupSettlementProof, replaceGroupSettlementProof } = await import("./group-settlement-proofs");

const groupId = "11111111-1111-4111-8111-111111111111";
const settlementId = "22222222-2222-4222-8222-222222222222";
const participantId = "33333333-3333-4333-8333-333333333333";

function query(rows: unknown[]) {
  const result = {
    from() { return result; },
    where() { return result; },
    limit() { return result; },
    orderBy() { return result; },
    for() { return Promise.resolve(rows); },
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  };
  return result;
}

function databaseFor(rows: unknown[][], returningRows: unknown[] = []) {
  let index = 0;
  const transaction = {
    select: vi.fn(() => query(rows[index++] ?? [])),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) })) })),
  };
  const database = {
    transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { database: database as unknown as Database, transaction };
}

function authorizedRows(existing: unknown[] = []) {
  return [
    [{ senderParticipantId: participantId }],
    [{ id: participantId, userId: "user-a" }],
    [{ participantId, userId: "user-a" }],
    [{ id: settlementId, state: "pending", senderParticipantId: participantId }],
    existing,
  ];
}

describe("Group settlement proof service", () => {
  it("persists normalized bytes and metadata", async () => {
    const file = await createValidatedReceiptImage("transfer.png");
    const database = databaseFor(authorizedRows(), [{ id: "proof-a", originalFilename: "transfer.webp", mediaType: "image/webp", byteSize: 1, createdAt: new Date() }]);

    await createGroupSettlementProof(database.database, groupId, settlementId, "user-a", file);

    const stored = database.transaction.insert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(stored).toMatchObject({ originalFilename: "transfer.webp", mediaType: "image/webp", byteSize: stored.content.byteLength });
    expect(Buffer.from(stored.content).subarray(0, 4).toString("latin1")).toBe("RIFF");
  });

  it("does not update an existing proof when replacement normalization fails", async () => {
    groupMocks.publishGroupSettlementFreshness.mockClear();
    const invalid = { ...(await createValidatedReceiptImage("transfer.png")), content: Uint8Array.from([0xff, 0xd8, 0xff]) };
    const database = databaseFor(authorizedRows([{ id: "proof-a" }]));

    await expect(replaceGroupSettlementProof(database.database, groupId, settlementId, "user-a", invalid)).rejects.toThrow("could not be processed");
    expect(database.transaction.update).not.toHaveBeenCalled();
    expect(database.transaction.insert).not.toHaveBeenCalled();
    expect(groupMocks.publishGroupSettlementFreshness).not.toHaveBeenCalled();
  });
});
