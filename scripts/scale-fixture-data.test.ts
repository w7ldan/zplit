import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  generateScaleFixture,
  SCALE_FIXTURE_COUNTS,
  SCALE_FIXTURE_SCENARIO_IDS,
} from "./scale-fixture-data";

function sums(fixture: ReturnType<typeof generateScaleFixture>) {
  const allocationsByRepayment = new Map<string, number>();
  const allocationsByShare = new Map<string, number>();
  for (const allocation of fixture.repaymentAllocations) {
    allocationsByRepayment.set(allocation.repaymentId, (allocationsByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount);
    allocationsByShare.set(allocation.expenseShareId, (allocationsByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount);
  }
  return { allocationsByRepayment, allocationsByShare };
}

describe("scale fixture data", () => {
  it("is deterministic for the fixed seed", () => {
    expect(generateScaleFixture("owner")).toEqual(generateScaleFixture("owner"));
  });

  it("keeps exact counts and active/archive split stable", () => {
    const fixture = generateScaleFixture("owner");
    expect(fixture.friends).toHaveLength(SCALE_FIXTURE_COUNTS.friends);
    expect(fixture.friends.filter((friend) => friend.archivedAt === null)).toHaveLength(SCALE_FIXTURE_COUNTS.activeFriends);
    expect(fixture.friends.filter((friend) => friend.archivedAt !== null)).toHaveLength(SCALE_FIXTURE_COUNTS.archivedFriends);
    expect(fixture.outings).toHaveLength(SCALE_FIXTURE_COUNTS.outings);
    expect(fixture.expenses).toHaveLength(SCALE_FIXTURE_COUNTS.expenses);
    expect(fixture.expenseShares).toHaveLength(SCALE_FIXTURE_COUNTS.expenseShares);
    expect(fixture.repayments).toHaveLength(SCALE_FIXTURE_COUNTS.repayments);
    expect(fixture.repaymentAllocations).toHaveLength(SCALE_FIXTURE_COUNTS.repaymentAllocations);
    expect(fixture.receipts).toHaveLength(SCALE_FIXTURE_COUNTS.receipts);
  });

  it("contains complete PNG receipts with matching metadata", () => {
    const fixture = generateScaleFixture("owner");
    for (const receipt of fixture.receipts) {
      expect(receipt.mediaType).toBe("image/png");
      expect(receipt.originalFilename).toMatch(/\.png$/);
      expect(receipt.byteSize).toBe(receipt.content.byteLength);
      expect(receipt.sha256).toBe(createHash("sha256").update(receipt.content).digest("hex"));
      expect(receipt.content.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));

      const chunks: { type: string; data: Buffer; bytes: Buffer }[] = [];
      for (let offset = 8; offset < receipt.content.length;) {
        const length = receipt.content.readUInt32BE(offset);
        const end = offset + 12 + length;
        expect(end).toBeLessThanOrEqual(receipt.content.length);
        chunks.push({
          type: receipt.content.toString("ascii", offset + 4, offset + 8),
          data: receipt.content.subarray(offset + 8, offset + 8 + length),
          bytes: receipt.content.subarray(offset, end),
        });
        offset = end;
      }

      expect(chunks.map(({ type }) => type)).toEqual(["IHDR", "IDAT", "IEND"]);
      expect(chunks.map(({ bytes }) => bytes.toString("hex"))).toEqual([
        "0000000d4948445200000001000000010804000000b51c0c02",
        "0000000b4944415478da6364f80f00010501012718e366",
        "0000000049454e44ae426082",
      ]);
      expect(inflateSync(chunks[1]!.data)).toEqual(Buffer.from([1, 0, 255]));
    }
  });

  it("contains long valid names, 36 months, and timezone boundaries", () => {
    const fixture = generateScaleFixture("owner");
    expect(fixture.friends[0]!.name).toHaveLength(120);
    expect(fixture.outings[0]!.title).toHaveLength(160);
    expect(fixture.expenses[0]!.description).toHaveLength(200);
    expect(new Set(fixture.outings.map(({ occurredAt }) => `${occurredAt.getUTCFullYear()}-${occurredAt.getUTCMonth()}`))).toHaveLength(36);
    expect(fixture.outings.slice(0, 3).map(({ occurredAt }) => occurredAt.toISOString())).toEqual([
      "2023-01-31T23:59:59.999Z",
      "2023-02-01T00:00:00.000Z",
      "2023-02-28T10:00:00.000Z",
    ]);
    expect(fixture.repayments.slice(0, 3).map(({ paidAt }) => paidAt.toISOString())).toEqual([
      "2024-03-31T23:59:59.999Z",
      "2024-04-01T00:00:00.000Z",
      "2024-04-30T16:00:00.000Z",
    ]);
  });

  it("includes every required financial scenario", () => {
    const fixture = generateScaleFixture("owner");
    const { allocationsByRepayment, allocationsByShare } = sums(fixture);
    const sharesByExpense = new Map<string, typeof fixture.expenseShares>();
    for (const share of fixture.expenseShares) sharesByExpense.set(share.expenseId, [...(sharesByExpense.get(share.expenseId) ?? []), share]);
    const allocatedForExpense = (expenseId: string) => (sharesByExpense.get(expenseId) ?? []).reduce((sum, share) => sum + (allocationsByShare.get(share.id) ?? 0), 0);
    const owedForExpense = (expenseId: string) => (sharesByExpense.get(expenseId) ?? []).reduce((sum, share) => sum + share.amountOwed, 0);
    expect(sharesByExpense.get(SCALE_FIXTURE_SCENARIO_IDS.noSharesExpenseId) ?? []).toHaveLength(0);
    expect(allocatedForExpense(SCALE_FIXTURE_SCENARIO_IDS.fullyPaidExpenseId)).toBe(owedForExpense(SCALE_FIXTURE_SCENARIO_IDS.fullyPaidExpenseId));
    expect(allocatedForExpense(SCALE_FIXTURE_SCENARIO_IDS.partiallyPaidExpenseId)).toBeGreaterThan(0);
    expect(allocatedForExpense(SCALE_FIXTURE_SCENARIO_IDS.partiallyPaidExpenseId)).toBeLessThan(owedForExpense(SCALE_FIXTURE_SCENARIO_IDS.partiallyPaidExpenseId));
    expect(allocatedForExpense(SCALE_FIXTURE_SCENARIO_IDS.unpaidExpenseId)).toBe(0);
    const overpaid = fixture.repayments.find(({ id }) => id === SCALE_FIXTURE_SCENARIO_IDS.overpaidRepaymentId)!;
    expect(overpaid.amount).toBeGreaterThan(allocationsByRepayment.get(overpaid.id) ?? 0);
    const unallocated = fixture.repayments.find(({ id }) => id === SCALE_FIXTURE_SCENARIO_IDS.unallocatedRepaymentId)!;
    expect(allocationsByRepayment.get(unallocated.id) ?? 0).toBe(0);
    expect(sharesByExpense.get(SCALE_FIXTURE_SCENARIO_IDS.severalFriendsExpenseId)).toHaveLength(2);
    expect(fixture.receipts.length).toBeGreaterThan(0);
  });

  it("contains no invalid shares or allocations", () => {
    const fixture = generateScaleFixture("owner");
    const expenses = new Map(fixture.expenses.map((expense) => [expense.id, expense]));
    const shares = new Map(fixture.expenseShares.map((share) => [share.id, share]));
    const repayments = new Map(fixture.repayments.map((repayment) => [repayment.id, repayment]));
    const friends = new Map(fixture.friends.map((friend) => [friend.id, friend]));
    const { allocationsByRepayment, allocationsByShare } = sums(fixture);
    expect(fixture.expenseShares.every((share) => share.amountOwed > 0 && share.amountOwed <= expenses.get(share.expenseId)!.amount)).toBe(true);
    const owedByExpense = new Map<string, number>();
    for (const share of fixture.expenseShares) owedByExpense.set(share.expenseId, (owedByExpense.get(share.expenseId) ?? 0) + share.amountOwed);
    for (const [expenseId, amount] of owedByExpense) expect(amount).toBeLessThanOrEqual(expenses.get(expenseId)!.amount);
    expect(fixture.repaymentAllocations.every((allocation) => {
      const repayment = repayments.get(allocation.repaymentId)!;
      const share = shares.get(allocation.expenseShareId)!;
      return allocation.amount > 0 && allocation.amount <= repayment.amount && friends.get(repayment.friendId)!.id === friends.get(share.friendId)!.id;
    })).toBe(true);
    for (const [repaymentId, amount] of allocationsByRepayment) expect(amount).toBeLessThanOrEqual(repayments.get(repaymentId)!.amount);
    for (const [shareId, amount] of allocationsByShare) expect(amount).toBeLessThanOrEqual(shares.get(shareId)!.amountOwed);
  });

  it("keeps IDs and relationships unique and valid", () => {
    const fixture = generateScaleFixture("owner");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
    const unique = (values: string[]) => new Set(values).size === values.length && values.every((value) => uuid.test(value));
    expect(unique(fixture.friends.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.outings.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.expenses.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.expenseShares.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.repayments.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.receipts.map(({ id }) => id))).toBe(true);
    const friendIds = new Set(fixture.friends.map(({ id }) => id));
    const outingIds = new Set(fixture.outings.map(({ id }) => id));
    const expenseIds = new Set(fixture.expenses.map(({ id }) => id));
    const shareIds = new Set(fixture.expenseShares.map(({ id }) => id));
    const repaymentIds = new Set(fixture.repayments.map(({ id }) => id));
    expect(fixture.expenses.every(({ outingId }) => outingIds.has(outingId))).toBe(true);
    expect(fixture.expenseShares.every(({ expenseId, friendId }) => expenseIds.has(expenseId) && friendIds.has(friendId))).toBe(true);
    expect(fixture.repayments.every(({ friendId }) => friendIds.has(friendId))).toBe(true);
    expect(fixture.receipts.every(({ expenseId }) => expenseIds.has(expenseId))).toBe(true);
    const pairs = fixture.repaymentAllocations.map(({ repaymentId, expenseShareId }) => `${repaymentId}:${expenseShareId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(fixture.repaymentAllocations.every(({ repaymentId, expenseShareId }) => repaymentIds.has(repaymentId) && shareIds.has(expenseShareId))).toBe(true);
  });
});
