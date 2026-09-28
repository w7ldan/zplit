import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => {
  class FakeGroupError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    FakeGroupError,
    requireGroupAccess: vi.fn(async () => ({})),
    lockActiveGroupForOperationalMutation: vi.fn(),
    createNotificationInDatabase: vi.fn(),
    publishNotificationStateChange: vi.fn(),
    publishRealtimeEvent: vi.fn(async () => undefined),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/server/groups", () => ({
  GroupError: mocks.FakeGroupError,
  requireGroupAccess: mocks.requireGroupAccess,
  lockActiveGroupForOperationalMutation: mocks.lockActiveGroupForOperationalMutation,
}));
vi.mock("@/server/notifications", () => ({ createNotificationInDatabase: mocks.createNotificationInDatabase, publishNotificationStateChange: mocks.publishNotificationStateChange }));
vi.mock("@/server/realtime", () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock("@/server/budgeting/sources-group", () => ({ reconcileGroupSettlement: vi.fn(async () => undefined) }));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/group-accounting", () => ({ readGroupBalances: vi.fn(async () => []) }));

import { createGroupOffsetRepository } from "./group-offsets";
import { createGroupSettlementRepository } from "./group-settlements";

const groupId = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const senderParticipantId = "33333333-3333-4333-8333-333333333333";
const recipientParticipantId = "44444444-4444-4444-8444-444444444444";
const actorUserId = "user-recipient";

function query(rows: unknown[], writes: string[]) {
  const builder = {
    from() { return builder; },
    innerJoin() { return builder; },
    leftJoin() { return builder; },
    where() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    offset() { return builder; },
    for() { return Promise.resolve(rows); },
    values() { writes.push("insert"); return builder; },
    set() { writes.push("update"); return builder; },
    returning() { return Promise.resolve(rows); },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(rows).then(resolve, reject); },
  };
  return builder;
}

function databaseFor(selects: unknown[][] = []) {
  const writes: string[] = [];
  const database = {
    select: vi.fn(() => query(selects.shift() ?? [], writes)),
    insert: vi.fn(() => query([], writes)),
    update: vi.fn(() => query([], writes)),
    delete: vi.fn(() => query([], writes)),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(database)),
  };
  return { database: database as unknown as Database, writes };
}

afterEach(() => vi.clearAllMocks());

describe("Group settlement and offset lifecycle guards", () => {
  it("rejects settlement create and confirmation after archive before writes or notifications", async () => {
    const pending = {
      id: recordId,
      groupId,
      senderParticipantId,
      recipientParticipantId,
      amount: 1,
      paymentMethod: "Cash",
      paidOn: "2026-09-10",
      state: "pending",
    };
    const createDatabase = databaseFor();
    mocks.lockActiveGroupForOperationalMutation.mockRejectedValueOnce(new mocks.FakeGroupError("archived"));
    await expect(createGroupSettlementRepository(createDatabase.database, groupId).createSettlement("user-sender", {
      senderParticipantId,
      recipientParticipantId,
      amount: 1,
      paymentMethod: "Cash",
      paidOn: "2026-09-10",
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(createDatabase.writes).toEqual([]);

    const confirmDatabase = databaseFor([[pending]]);
    mocks.lockActiveGroupForOperationalMutation.mockRejectedValueOnce(new mocks.FakeGroupError("archived"));
    await expect(createGroupSettlementRepository(confirmDatabase.database, groupId).confirmSettlement(recordId, actorUserId))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(confirmDatabase.writes).toEqual([]);
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("rejects offset create and confirmation after archive before writes or notifications", async () => {
    const createDatabase = databaseFor([[{ participantId: senderParticipantId }]]);
    mocks.lockActiveGroupForOperationalMutation.mockRejectedValueOnce(new mocks.FakeGroupError("archived"));
    await expect(createGroupOffsetRepository(createDatabase.database, groupId).createOffset("user-sender", {
      counterpartyParticipantId: recipientParticipantId,
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(createDatabase.writes).toEqual([]);

    const pending = {
      id: recordId,
      groupId,
      initiatorParticipantId: senderParticipantId,
      counterpartyParticipantId: recipientParticipantId,
      state: "pending",
    };
    const confirmDatabase = databaseFor([[pending]]);
    mocks.lockActiveGroupForOperationalMutation.mockRejectedValueOnce(new mocks.FakeGroupError("archived"));
    await expect(createGroupOffsetRepository(confirmDatabase.database, groupId).confirmOffset(recordId, actorUserId))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(confirmDatabase.writes).toEqual([]);
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });
});
