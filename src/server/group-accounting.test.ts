import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { groupExpenseLifecycleEvents, groupObligations } from "@/db/schema";

const mocks = vi.hoisted(() => {
  class FakeGroupError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    FakeGroupError,
    requireGroupAccess: vi.fn(async () => ({})),
    createNotificationInDatabase: vi.fn(),
    publishNotificationStateChange: vi.fn(),
    publishRealtimeEvent: vi.fn(async () => undefined),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/server/groups", () => ({ GroupError: mocks.FakeGroupError, requireGroupAccess: mocks.requireGroupAccess }));
vi.mock("@/server/notifications", () => ({ createNotificationInDatabase: mocks.createNotificationInDatabase, publishNotificationStateChange: mocks.publishNotificationStateChange }));
vi.mock("@/server/realtime", () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn() }));

import { createGroupAccountingRepository } from "./group-accounting";

const groupId = "11111111-1111-4111-8111-111111111111";
const expenseId = "22222222-2222-4222-8222-222222222222";
const payerParticipantId = "33333333-3333-4333-8333-333333333333";
const debtorParticipantId = "44444444-4444-4444-8444-444444444444";
const actorUserId = "user-payer";

function chain(value: unknown[]) {
  type FakeQuery = {
    from: (...args: unknown[]) => FakeQuery;
    leftJoin: (...args: unknown[]) => FakeQuery;
    innerJoin: (...args: unknown[]) => FakeQuery;
    where: (...args: unknown[]) => FakeQuery;
    limit: (...args: unknown[]) => FakeQuery;
    orderBy: (...args: unknown[]) => FakeQuery;
    set: (...args: unknown[]) => FakeQuery;
    values: (...args: unknown[]) => FakeQuery;
    for: () => Promise<unknown[]>;
    returning: () => Promise<unknown[]>;
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
  };
  const query = {} as FakeQuery;
  const dynamicQuery = query as unknown as Record<string, unknown>;
  for (const method of ["from", "leftJoin", "innerJoin", "where", "limit", "orderBy"]) dynamicQuery[method] = vi.fn(() => query);
  query.for = vi.fn(() => Promise.resolve(value));
  query.returning = vi.fn(async () => value);
  query.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject);
  return query;
}

function databaseFor(selects: unknown[][], updates: unknown[][], inserts: unknown[][]) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const select = vi.fn(() => chain(selects.shift() ?? []));
  const update = vi.fn(() => {
    const query = chain(updates.shift() ?? []);
    query.set = vi.fn(() => query);
    return query;
  });
  const insert = vi.fn((table: unknown) => {
    const query = chain(inserts.shift() ?? []);
    query.values = vi.fn((values: unknown) => { inserted.push({ table, values }); return query; });
    return query;
  });
  const transaction = { select, update, insert };
  const database = {
    select,
    update,
    insert,
    transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as Database;
  return { database, inserted, update };
}

function expense(state: "pending" | "confirmed" | "rejected" | "voided") {
  return { id: expenseId, groupId, creatorParticipantId: debtorParticipantId, payerParticipantId, description: "Dinner", occurredAt: new Date("2026-08-28T12:00:00Z"), totalAmount: 100, state, confirmedAt: state === "confirmed" || state === "voided" ? new Date("2026-08-28T12:01:00Z") : null, createdAt: new Date("2026-08-28T12:00:00Z"), updatedAt: new Date("2026-08-28T12:01:00Z") };
}

const share = { id: "55555555-5555-4555-8555-555555555555", groupId, expenseId, participantId: debtorParticipantId, amount: 100, createdAt: new Date(), updatedAt: new Date() };
const payer = { id: payerParticipantId, userId: actorUserId };
const membership = { participantId: payerParticipantId };
const participantMap = [{ id: debtorParticipantId, userId: "user-creator", externalName: null, label: null, userName: "Creator", membershipUserId: "user-creator" }, { id: payerParticipantId, userId: actorUserId, externalName: null, label: null, userName: "Payer", membershipUserId: actorUserId }];

function detailSelects(currentExpense: ReturnType<typeof expense>, obligations: unknown[], lifecycleEvent: unknown) {
  return [[currentExpense], [share], obligations, [], [lifecycleEvent], [], participantMap, [{ userId: actorUserId }]];
}

afterEach(() => vi.clearAllMocks());

describe("Group expense lifecycle server operations", () => {
  it("confirms only the claimed payer and appends obligations and lifecycle history atomically", async () => {
    const confirmed = expense("confirmed");
    const event = { id: "event-confirm", groupId, expenseId, eventType: "payer_confirmed", actorUserId: actorUserId, fromState: "pending", toState: "confirmed", createdAt: new Date() };
    const db = databaseFor([[expense("pending")], [share], [payer, { id: debtorParticipantId, userId: "user-creator" }], [membership], [expense("pending")], [share], ...detailSelects(confirmed, [{ id: "obligation-a", groupId, sourceExpenseId: expenseId, sourceShareId: share.id, debtorParticipantId, creditorParticipantId: payerParticipantId, originalAmount: 100, voidedAt: null, createdAt: new Date() }], event)], [[confirmed], []], [[], [event]]);

    const result = await createGroupAccountingRepository(db.database, groupId).confirmExpenseAsPayer(expenseId, actorUserId);

    expect(result.state).toBe("confirmed");
    expect(db.inserted).toEqual(expect.arrayContaining([
      { table: groupObligations, values: expect.arrayContaining([expect.objectContaining({ sourceExpenseId: expenseId, creditorParticipantId: payerParticipantId, originalAmount: 100 })]) },
      { table: groupExpenseLifecycleEvents, values: expect.objectContaining({ eventType: "payer_confirmed", actorUserId, fromState: "pending", toState: "confirmed" }) },
    ]));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(actorUserId, "resolved");
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recipientUserId: "user-creator",
      type: "group.expense.payer.claim.outcome",
      metadata: { expenseId, groupId, description: "Dinner", status: "confirmed" },
      dedupeKey: `group-expense-payer-claim-outcome:${expenseId}:confirmed`,
    }));
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(actorUserId, expect.objectContaining({ type: "group.expense.state.changed" }));
  });

  it("rejects a claim without creating obligations and denies the creator", async () => {
    const rejected = expense("rejected");
    const event = { id: "event-reject", groupId, expenseId, eventType: "payer_rejected", actorUserId, fromState: "pending", toState: "rejected", createdAt: new Date() };
    const denied = databaseFor([[expense("pending")], [share], [payer], [membership]], [], []);
    await expect(createGroupAccountingRepository(denied.database, groupId).confirmExpenseAsPayer(expenseId, "user-creator")).rejects.toMatchObject({ code: "forbidden" });
    const db = databaseFor([[expense("pending")], [payer, { id: debtorParticipantId, userId: "user-creator" }], [membership], [expense("pending")], [rejected], ...detailSelects(rejected, [], event)], [[rejected], []], [[event]]);
    const repository = createGroupAccountingRepository(db.database, groupId);

    await expect(repository.rejectExpenseAsPayer(expenseId, actorUserId)).resolves.toMatchObject({ state: "rejected" });
    expect(db.inserted.some(({ table }) => table === groupObligations)).toBe(false);
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recipientUserId: "user-creator",
      type: "group.expense.payer.claim.outcome",
      metadata: { expenseId, groupId, description: "Dinner", status: "rejected" },
      dedupeKey: `group-expense-payer-claim-outcome:${expenseId}:rejected`,
    }));
  });

  it("voids only an active payer claim and preserves reversed obligations", async () => {
    const confirmed = expense("confirmed");
    const voided = expense("voided");
    const obligation = { id: "obligation-a", groupId, sourceExpenseId: expenseId, sourceShareId: share.id, debtorParticipantId, creditorParticipantId: payerParticipantId, originalAmount: 100, voidedAt: null, createdAt: new Date() };
    const event = { id: "event-void", groupId, expenseId, eventType: "voided", actorUserId, fromState: "confirmed", toState: "voided", createdAt: new Date() };
    const db = databaseFor([[confirmed], [payer], [membership], [share], [obligation], [{ userId: actorUserId }], ...detailSelects(voided, [{ ...obligation, voidedAt: new Date() }], event)], [[voided], [{ id: obligation.id }]], [[event]]);

    const result = await createGroupAccountingRepository(db.database, groupId).voidExpenseAsPayer(expenseId, actorUserId);

    expect(result).toMatchObject({ state: "voided" });
    expect(result.obligations).toHaveLength(1);
    expect(result.obligations[0]?.originalAmount).toBe(100);
    expect(result.obligations[0]?.voidedAt).not.toBeNull();
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid void actor and an inactive payer without mutation", async () => {
    const confirmed = expense("confirmed");
    const wrongActor = databaseFor([[confirmed], [payer], [membership]], [], []);
    await expect(createGroupAccountingRepository(wrongActor.database, groupId).voidExpenseAsPayer(expenseId, "user-creator")).rejects.toMatchObject({ code: "forbidden" });
    expect(wrongActor.update).not.toHaveBeenCalled();

    const inactive = databaseFor([[confirmed], [payer], []], [], []);
    await expect(createGroupAccountingRepository(inactive.database, groupId).voidExpenseAsPayer(expenseId, actorUserId)).rejects.toMatchObject({ code: "not_member" });
    expect(inactive.update).not.toHaveBeenCalled();
  });

  it("loads obligation applications in one batch and keeps access Group-scoped", async () => {
    const obligation = {
      id: "66666666-6666-4666-8666-666666666666",
      groupId,
      sourceExpenseId: expenseId,
      sourceShareId: share.id,
      debtorParticipantId,
      creditorParticipantId: payerParticipantId,
      originalAmount: 100,
      voidedAt: null,
      createdAt: new Date(),
    };
    const application = {
      id: "application-a",
      obligationId: obligation.id,
      settlementId: "settlement-a",
      appliedAmount: 40,
      createdAt: new Date(),
      settlementConfirmedAt: new Date(),
    };
    const db = databaseFor(
      [[expense("confirmed")], [share], [obligation], [], [], participantMap, [application]],
      [],
      [],
    );

    const result = await createGroupAccountingRepository(db.database, groupId).getExpense(expenseId, actorUserId);

    expect(result.obligations[0]?.applications).toEqual([expect.objectContaining({ appliedAmount: 40 })]);
    expect(result.obligations[0]?.explanatoryUnappliedAmount).toBe(60);

    mocks.requireGroupAccess.mockRejectedValueOnce(new mocks.FakeGroupError("not_member"));
    await expect(createGroupAccountingRepository(db.database, groupId).getObligationApplications(obligation.id, "former-user")).rejects.toMatchObject({ code: "not_member" });
  });
});
