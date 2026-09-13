import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { calculateSafeDaily } from "../src/domain/budgeting/dates";
import { normalizeNotificationMetadata } from "../src/domain/notifications";
import {
  generateScaleFixture,
  SCALE_ACTIVE_BUDGET_PERIOD_NAME,
  SCALE_FIXTURE_COUNTS,
  SCALE_FIXTURE_SCENARIO_IDS,
  SCALE_GROUP_ANCHORS,
  SCALE_HEAVY_RECURRING_NAME,
  SCALE_ORGANIZATION_ANCHORS,
  SCALE_SCENARIO_ANCHORS,
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
      "2026-01-31T23:59:59.999Z",
      "2026-02-01T00:00:00.000Z",
      "2026-02-28T10:00:00.000Z",
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

describe("full-product scale fixture data", () => {
  let fixture: ReturnType<typeof generateScaleFixture>;
  beforeAll(() => {
    fixture = generateScaleFixture("owner");
  });

  it("is deterministic across runs for every domain", () => {
    expect(generateScaleFixture("owner")).toEqual(fixture);
  });

  it("keeps exact collaboration counts stable", () => {
    expect(fixture.secondaryUsers).toHaveLength(SCALE_FIXTURE_COUNTS.secondaryUsers);
    expect(fixture.friendConnections).toHaveLength(SCALE_FIXTURE_COUNTS.friendConnections);
    expect(fixture.trips).toHaveLength(SCALE_FIXTURE_COUNTS.trips);
    expect(fixture.groups).toHaveLength(SCALE_FIXTURE_COUNTS.groups);
    expect(fixture.groupParticipants).toHaveLength(SCALE_FIXTURE_COUNTS.groupParticipants);
    expect(fixture.groupMemberships).toHaveLength(SCALE_FIXTURE_COUNTS.groupMemberships);
    expect(fixture.groupExpenses).toHaveLength(SCALE_FIXTURE_COUNTS.groupExpenses);
    expect(fixture.groupExpenseShares).toHaveLength(SCALE_FIXTURE_COUNTS.groupExpenseShares);
    expect(fixture.groupObligations).toHaveLength(SCALE_FIXTURE_COUNTS.groupObligations);
    expect(fixture.groupSettlements).toHaveLength(SCALE_FIXTURE_COUNTS.groupSettlements);
    expect(fixture.groupSettlementApplications).toHaveLength(SCALE_FIXTURE_COUNTS.groupSettlementApplications);
    expect(fixture.groupOffsets).toHaveLength(SCALE_FIXTURE_COUNTS.groupOffsets);
    expect(fixture.groupOffsetApplications).toHaveLength(SCALE_FIXTURE_COUNTS.groupOffsetApplications);
    expect(fixture.groupExpenseReceipts).toHaveLength(SCALE_FIXTURE_COUNTS.groupExpenseReceipts);
    expect(fixture.groupSettlementProofs).toHaveLength(SCALE_FIXTURE_COUNTS.groupSettlementProofs);
    expect(fixture.groupExpenseLifecycleEvents).toHaveLength(SCALE_FIXTURE_COUNTS.groupExpenseLifecycleEvents);
    expect(fixture.groupJoinRequests).toHaveLength(SCALE_FIXTURE_COUNTS.groupJoinRequests);
    expect(fixture.organizations).toHaveLength(SCALE_FIXTURE_COUNTS.organizations);
    expect(fixture.organizationScopes).toHaveLength(SCALE_FIXTURE_COUNTS.organizations);
    expect(fixture.organizationParticipants).toHaveLength(SCALE_FIXTURE_COUNTS.organizationParticipants);
    expect(fixture.organizationMemberships).toHaveLength(SCALE_FIXTURE_COUNTS.organizationMemberships);
    expect(fixture.organizationInvitations).toHaveLength(SCALE_FIXTURE_COUNTS.organizationInvitations);
    expect(fixture.organizationFriends).toHaveLength(SCALE_FIXTURE_COUNTS.organizationFriends);
    expect(fixture.organizationOutings).toHaveLength(SCALE_FIXTURE_COUNTS.organizationOutings);
    expect(fixture.organizationExpenses).toHaveLength(SCALE_FIXTURE_COUNTS.organizationExpenses);
    expect(fixture.organizationExpenseShares).toHaveLength(SCALE_FIXTURE_COUNTS.organizationExpenseShares);
    expect(fixture.organizationRepayments).toHaveLength(SCALE_FIXTURE_COUNTS.organizationRepayments);
    expect(fixture.organizationRepaymentAllocations).toHaveLength(SCALE_FIXTURE_COUNTS.organizationRepaymentAllocations);
    expect(fixture.organizationReceipts).toHaveLength(SCALE_FIXTURE_COUNTS.organizationReceipts);
    expect(fixture.budgetPeriods).toHaveLength(SCALE_FIXTURE_COUNTS.budgetPeriods);
    expect(fixture.budgetCategories).toHaveLength(SCALE_FIXTURE_COUNTS.budgetCategories);
    expect(fixture.budgetPeriodCategories).toHaveLength(SCALE_FIXTURE_COUNTS.budgetPeriodCategories);
    expect(fixture.budgetTransactions).toHaveLength(SCALE_FIXTURE_COUNTS.budgetTransactions);
    expect(fixture.budgetImpacts).toHaveLength(SCALE_FIXTURE_COUNTS.budgetImpacts);
    expect(fixture.budgetPersonalExpenseSources).toHaveLength(SCALE_FIXTURE_COUNTS.budgetPersonalExpenseSources);
    expect(fixture.budgetPersonalExpenseExclusions).toHaveLength(SCALE_FIXTURE_COUNTS.budgetPersonalExpenseExclusions);
    expect(fixture.budgetPersonalRepaymentSources).toHaveLength(SCALE_FIXTURE_COUNTS.budgetPersonalRepaymentSources);
    expect(fixture.budgetGroupExpenseSources).toHaveLength(SCALE_FIXTURE_COUNTS.budgetGroupExpenseSources);
    expect(fixture.budgetGroupExpenseExclusions).toHaveLength(SCALE_FIXTURE_COUNTS.budgetGroupExpenseExclusions);
    expect(fixture.budgetGroupSettlementSources).toHaveLength(SCALE_FIXTURE_COUNTS.budgetGroupSettlementSources);
    expect(fixture.budgetGroupObligationClassifications).toHaveLength(SCALE_FIXTURE_COUNTS.budgetGroupObligationClassifications);
    expect(fixture.recurringTemplates).toHaveLength(SCALE_FIXTURE_COUNTS.recurringTemplates);
    expect(fixture.recurringTemplates.filter((template) => template.archivedAt === null)).toHaveLength(SCALE_FIXTURE_COUNTS.activeRecurringTemplates);
    expect(fixture.recurringOccurrences).toHaveLength(SCALE_FIXTURE_COUNTS.recurringOccurrences);
    expect(fixture.notifications).toHaveLength(SCALE_FIXTURE_COUNTS.notifications);
    expect(fixture.chatThreads).toHaveLength(SCALE_FIXTURE_COUNTS.chatThreads);
    expect(fixture.chatMessages).toHaveLength(SCALE_FIXTURE_COUNTS.chatMessages);
  });

  it("keeps generated IDs unique and well-formed", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
    const unique = (values: string[]) => new Set(values).size === values.length && values.every((value) => uuid.test(value));
    expect(unique(fixture.groups.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupParticipants.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupExpenses.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupExpenseShares.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupObligations.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupSettlements.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.groupOffsets.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.organizations.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.organizationParticipants.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.budgetPeriods.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.budgetCategories.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.budgetTransactions.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.budgetImpacts.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.recurringTemplates.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.recurringOccurrences.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.notifications.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.chatThreads.map(({ id }) => id))).toBe(true);
    expect(unique(fixture.chatMessages.map(({ id }) => id))).toBe(true);
    expect(new Set(fixture.secondaryUsers.map(({ id }) => id)).size).toBe(fixture.secondaryUsers.length);
    expect(fixture.secondaryUsers.every(({ email }) => email === email.toLowerCase())).toBe(true);
    expect(fixture.secondaryUsers.every(({ username }) => /^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(username) && username.length >= 3 && username.length <= 20)).toBe(true);
    for (const connection of fixture.friendConnections) {
      expect(connection.userAId < connection.userBId).toBe(true);
    }
  });

  it("exposes memorable scenario anchors", () => {
    for (const name of SCALE_GROUP_ANCHORS) expect(fixture.groups.some((group) => group.name === name)).toBe(true);
    for (const name of SCALE_ORGANIZATION_ANCHORS) expect(fixture.organizations.some((organization) => organization.name === name)).toBe(true);
    expect(SCALE_SCENARIO_ANCHORS.budgetPeriod).toBe(SCALE_ACTIVE_BUDGET_PERIOD_NAME);
    expect(SCALE_SCENARIO_ANCHORS.heavyRecurring).toBe(SCALE_HEAVY_RECURRING_NAME);
    expect(fixture.trips.some((trip) => trip.name === "Japan Trip 2026")).toBe(true);
    expect(fixture.budgetPeriods.some((period) => period.name === SCALE_ACTIVE_BUDGET_PERIOD_NAME && period.status === "active")).toBe(true);
    expect(fixture.recurringTemplates.some((template) => template.name === SCALE_HEAVY_RECURRING_NAME && template.archivedAt === null)).toBe(true);
  });

  it("covers every Group lifecycle and identity shape", () => {
    const states = new Set(fixture.groupExpenses.map(({ state }) => state));
    expect(states).toEqual(new Set(["pending", "confirmed", "rejected", "voided"]));
    expect(new Set(fixture.groupSettlements.map(({ state }) => state))).toEqual(new Set(["pending", "confirmed"]));
    expect(new Set(fixture.groupOffsets.map(({ state }) => state))).toEqual(new Set(["pending", "confirmed"]));
    for (const participant of fixture.groupParticipants) {
      expect((participant.userId !== null) === (participant.displayName === null)).toBe(true);
    }
    expect(fixture.groupParticipants.some((participant) => participant.userId === null)).toBe(true);
    for (const group of fixture.groups) {
      const owners = fixture.groupMemberships.filter((membership) => membership.groupId === group.id && membership.role === "owner");
      expect(owners).toHaveLength(1);
    }
    const pendingExpenseIds = new Set(fixture.groupExpenses.filter(({ state }) => state === "pending" || state === "rejected").map(({ id }) => id));
    expect(fixture.groupObligations.every(({ sourceExpenseId }) => !pendingExpenseIds.has(sourceExpenseId))).toBe(true);
    expect(fixture.groupSettlementApplications.every((application) => {
      const settlement = fixture.groupSettlements.find(({ id }) => id === application.settlementId)!;
      const obligation = fixture.groupObligations.find(({ id }) => id === application.obligationId)!;
      return settlement.senderParticipantId === obligation.debtorParticipantId && settlement.recipientParticipantId === obligation.creditorParticipantId;
    })).toBe(true);
  });

  it("keeps Group settlement and offset applications within eligible amounts", () => {
    const appliedBySettlement = new Map<string, number>();
    for (const application of fixture.groupSettlementApplications) {
      appliedBySettlement.set(application.settlementId, (appliedBySettlement.get(application.settlementId) ?? 0) + application.appliedAmount);
    }
    for (const settlement of fixture.groupSettlements.filter(({ state }) => state === "confirmed")) {
      expect(appliedBySettlement.get(settlement.id)).toBe(settlement.amount);
    }
    for (const settlement of fixture.groupSettlements.filter(({ state }) => state === "pending")) {
      expect(appliedBySettlement.get(settlement.id) ?? 0).toBe(0);
    }
    const appliedByObligation = new Map<string, number>();
    for (const application of [...fixture.groupSettlementApplications, ...fixture.groupOffsetApplications]) {
      const key = application.obligationId;
      appliedByObligation.set(key, (appliedByObligation.get(key) ?? 0) + application.appliedAmount);
    }
    const obligations = new Map(fixture.groupObligations.map((obligation) => [obligation.id, obligation]));
    for (const [obligationId, total] of appliedByObligation) {
      expect(total).toBeLessThanOrEqual(obligations.get(obligationId)!.originalAmount);
    }
  });

  it("covers Organization roles and ledger activity", () => {
    const ownerRoles = new Set(fixture.organizationMemberships.filter(({ userId }) => userId === "owner").map(({ role }) => role));
    expect(ownerRoles.has("owner")).toBe(true);
    expect(ownerRoles.size).toBeGreaterThan(1);
    expect(fixture.organizations.some(({ archivedAt }) => archivedAt !== null)).toBe(true);
    expect(new Set(fixture.organizationInvitations.map(({ status }) => status)).size).toBeGreaterThan(3);
    expect(fixture.organizationScopes.every(({ organizationId }) => fixture.organizations.some(({ id }) => id === organizationId))).toBe(true);
    const friendIds = new Set(fixture.organizationFriends.map(({ id }) => id));
    expect(fixture.organizationExpenseShares.every(({ friendId }) => friendIds.has(friendId))).toBe(true);
  });

  it("keeps Budget periods, categories, and recurrence coherent", () => {
    expect(fixture.budgetPeriods.filter(({ status }) => status === "active")).toHaveLength(1);
    expect(new Set(fixture.budgetPeriods.map(({ ordinal }) => ordinal)).size).toBe(fixture.budgetPeriods.length);
    expect(fixture.budgetCategories.filter(({ systemKey }) => systemKey === "uncategorized")).toHaveLength(1);
    const impactsByTransaction = new Map<string, number>();
    for (const impact of fixture.budgetImpacts) {
      impactsByTransaction.set(impact.budgetTransactionId, (impactsByTransaction.get(impact.budgetTransactionId) ?? 0) + impact.amount);
      if (impact.status === "pending") {
        expect(impact.budgetPeriodId).toBeNull();
      } else {
        expect(impact.budgetPeriodId).not.toBeNull();
      }
    }
    const transactions = new Map(fixture.budgetTransactions.map((transaction) => [transaction.id, transaction]));
    for (const [transactionId, total] of impactsByTransaction) {
      expect(total).toBe(transactions.get(transactionId)!.amount);
    }
    const occurrenceKeys = fixture.recurringOccurrences.map(({ recurringTemplateId, scheduledOn }) => `${recurringTemplateId}:${scheduledOn}`);
    expect(new Set(occurrenceKeys).size).toBe(occurrenceKeys.length);
    expect(new Set(fixture.recurringOccurrences.map(({ status }) => status))).toEqual(new Set(["due", "recorded", "skipped"]));
    for (const occurrence of fixture.recurringOccurrences) {
      expect((occurrence.status === "recorded") === (occurrence.budgetTransactionId !== null)).toBe(true);
    }
    for (const template of fixture.recurringTemplates) {
      expect(template.spreadCount).toBeGreaterThanOrEqual(1);
      expect(template.spreadCount).toBeLessThanOrEqual(24);
      expect(template.spreadCount).toBeLessThanOrEqual(template.amount);
    }
  });

  it("keeps explicit Budget exclusions rare, durable, and distinct from legacy sources", () => {
    const activeStartsOn = "2026-09-01";
    const activeEndsOn = "2026-09-30";
    const outingById = new Map(fixture.outings.map((outing) => [outing.id, outing]));
    const linkedExpenseIds = new Set(fixture.budgetPersonalExpenseSources.map(({ expenseId }) => expenseId));
    const personalExclusionIds = new Set(fixture.budgetPersonalExpenseExclusions.map(({ expenseId }) => expenseId));
    expect(personalExclusionIds.size).toBe(fixture.budgetPersonalExpenseExclusions.length);
    for (const expenseId of personalExclusionIds) {
      expect(linkedExpenseIds.has(expenseId)).toBe(false);
    }
    expect(fixture.budgetPersonalExpenseExclusions.length).toBeLessThanOrEqual(fixture.expenses.length / 10);
    const excludedActivePersonal = fixture.expenses.filter((expense) => {
      if (!personalExclusionIds.has(expense.id)) return false;
      const occurredOn = outingById.get(expense.outingId)?.occurredOn;
      return occurredOn !== null && occurredOn !== undefined && occurredOn >= activeStartsOn && occurredOn <= activeEndsOn;
    });
    expect(excludedActivePersonal.length).toBeGreaterThan(0);
    const legacyActivePersonal = fixture.expenses.filter((expense) => {
      if (linkedExpenseIds.has(expense.id) || personalExclusionIds.has(expense.id)) return false;
      const occurredOn = outingById.get(expense.outingId)?.occurredOn;
      return occurredOn !== null && occurredOn !== undefined && occurredOn >= activeStartsOn && occurredOn <= activeEndsOn;
    });
    expect(legacyActivePersonal.length).toBeGreaterThan(0);
    const transactionById = new Map(fixture.budgetTransactions.map((transaction) => [transaction.id, transaction]));
    const variedPersonalLinks = fixture.budgetPersonalExpenseSources.filter(({ budgetTransactionId }) => {
      const transaction = transactionById.get(budgetTransactionId)!;
      return transaction.occurredOn < activeStartsOn;
    });
    const categorizedImpactCategories = new Set(fixture.budgetImpacts
      .filter((impact) => variedPersonalLinks.some(({ budgetTransactionId }) => budgetTransactionId === impact.budgetTransactionId))
      .map(({ budgetCategoryId }) => budgetCategoryId));
    expect(categorizedImpactCategories.size).toBeGreaterThan(1);

    const payerParticipantIds = new Set(fixture.groupParticipants.filter(({ userId }) => userId !== null).map(({ id }) => id));
    const linkedGroupExpenseIds = new Set(fixture.budgetGroupExpenseSources.map(({ groupExpenseId }) => groupExpenseId));
    const groupExclusionIds = new Set(fixture.budgetGroupExpenseExclusions.map(({ groupExpenseId }) => groupExpenseId));
    expect(groupExclusionIds.size).toBe(fixture.budgetGroupExpenseExclusions.length);
    for (const groupExpenseId of groupExclusionIds) {
      expect(linkedGroupExpenseIds.has(groupExpenseId)).toBe(false);
    }
    const excludedActiveGroup = fixture.groupExpenses.filter((expense) => groupExclusionIds.has(expense.id)
      && payerParticipantIds.has(expense.payerParticipantId)
      && expense.occurredOn >= activeStartsOn
      && expense.occurredOn <= activeEndsOn);
    expect(excludedActiveGroup.length).toBeGreaterThan(0);
    const legacyActiveGroup = fixture.groupExpenses.filter((expense) => !groupExclusionIds.has(expense.id)
      && !linkedGroupExpenseIds.has(expense.id)
      && expense.state === "confirmed"
      && payerParticipantIds.has(expense.payerParticipantId)
      && expense.occurredOn >= activeStartsOn
      && expense.occurredOn <= activeEndsOn);
    expect(legacyActiveGroup.length).toBeGreaterThan(0);
  });

  it("produces only supported notification shapes", () => {
    const types = new Set(fixture.notifications.map(({ type }) => type));
    expect(types.size).toBeGreaterThanOrEqual(8);
    for (const notification of fixture.notifications) {
      expect(() => normalizeNotificationMetadata(notification.type as never, notification.metadata)).not.toThrow();
    }
    expect(fixture.notifications.some(({ readAt }) => readAt === null)).toBe(true);
    expect(fixture.notifications.some(({ readAt }) => readAt !== null)).toBe(true);
  });

  it("keeps chat threads and messages coherent", () => {
    const threadIds = new Set(fixture.chatThreads.map(({ id }) => id));
    expect(fixture.chatThreads.filter(({ groupId }) => groupId !== null)).toHaveLength(fixture.groups.length);
    expect(fixture.chatThreads.filter(({ organizationId }) => organizationId !== null)).toHaveLength(fixture.organizations.length);
    for (const message of fixture.chatMessages) {
      expect(threadIds.has(message.threadId)).toBe(true);
      expect(message.body.length).toBeGreaterThan(0);
      expect(message.body.length).toBeLessThanOrEqual(4000);
      if (message.groupId) {
        expect(message.senderParticipantId).not.toBeNull();
      } else {
        expect(message.senderParticipantId).toBeNull();
      }
    }
    const perThread = new Map<string, number>();
    for (const message of fixture.chatMessages) perThread.set(message.threadId, (perThread.get(message.threadId) ?? 0) + 1);
    expect(Math.max(...perThread.values())).toBeGreaterThanOrEqual(1000);
  });

  it("links Personal dates and trips for Budget ingestion", () => {
    expect(fixture.outings.every(({ occurredOn }) => /^\d{4}-\d{2}-\d{2}$/.test(occurredOn))).toBe(true);
    expect(fixture.repayments.every(({ paidOn }) => /^\d{4}-\d{2}-\d{2}$/.test(paidOn))).toBe(true);
    expect(fixture.friends.filter(({ linkedUserId }) => linkedUserId !== null)).toHaveLength(SCALE_FIXTURE_COUNTS.linkedFriends);
    const tripIds = new Set(fixture.trips.map(({ id }) => id));
    expect(fixture.outings.filter(({ tripId }) => tripId !== null).length).toBeGreaterThan(0);
    expect(fixture.outings.every(({ tripId }) => tripId === null || tripIds.has(tripId))).toBe(true);
  });
});

describe("scale active budget realism", () => {
  const owner = "owner";
  const activeStartsOn = "2026-09-01";
  const activeEndsOn = "2026-09-30";
  const referenceDate = "2026-09-15";

  function activeSummary() {
    const data = generateScaleFixture(owner);
    const active = data.budgetPeriods.find((period) => period.status === "active")!;
    const transactions = new Map(data.budgetTransactions.map((row) => [row.id, row]));
    let outflow = 0;
    let inflow = 0;
    for (const impact of data.budgetImpacts) {
      if (impact.status !== "applied" || impact.budgetPeriodId !== active.id) continue;
      const transaction = transactions.get(impact.budgetTransactionId)!;
      if (transaction.status !== "posted") continue;
      if (transaction.direction === "outflow") outflow += impact.amount;
      else inflow += impact.amount;
    }
    const netSpent = outflow - inflow;
    const remaining = active.totalBudget - netSpent;
    const allocated = data.budgetPeriodCategories
      .filter((row) => row.budgetPeriodId === active.id)
      .reduce((sum, row) => sum + row.allocatedAmount, 0);
    return { data, active, outflow, inflow, netSpent, remaining, allocated, unallocated: active.totalBudget - allocated };
  }

  it("keeps overall Budget scale in the thousands", () => {
    const { data } = activeSummary();
    expect(data.budgetPeriods).toHaveLength(20);
    expect(data.budgetTransactions.length).toBeGreaterThan(3000);
    expect(data.budgetImpacts.length).toBeGreaterThan(2900);
    expect(data.recurringTemplates).toHaveLength(75);
  });

  it("bounds active manual volume relative to historical periods", () => {
    const { data } = activeSummary();
    const activeManual = data.budgetTransactions.filter((row) => row.origin === "manual" && row.occurredOn >= activeStartsOn && row.occurredOn <= activeEndsOn);
    const historicalManual = data.budgetTransactions.filter((row) => row.origin === "manual" && row.occurredOn < activeStartsOn);
    expect(activeManual.length).toBeLessThan(60);
    expect(historicalManual.length).toBeGreaterThan(2000);
    expect(activeManual.length).toBeLessThan(historicalManual.length / 20);
  });

  it("keeps the active period realistic with positive remaining and Safe Daily", () => {
    const { active, netSpent, remaining, unallocated } = activeSummary();
    expect(active.totalBudget).toBe(20_000_000);
    expect(netSpent).toBeGreaterThanOrEqual(10_000_000);
    expect(netSpent).toBeLessThanOrEqual(15_000_000);
    expect(netSpent).toBeLessThan(active.totalBudget);
    expect(remaining).toBeGreaterThan(0);
    expect(unallocated).toBeGreaterThan(0);
    expect(calculateSafeDaily(active.startsOn, active.endsOn, referenceDate, remaining)).toBeGreaterThan(0);
  });

  it("covers near/over, remaining, unallocated, and linked plus recurring activity", () => {
    const { data, active } = activeSummary();
    const transactions = new Map(data.budgetTransactions.map((row) => [row.id, row]));
    const netByCategory = new Map<string, number>();
    for (const impact of data.budgetImpacts) {
      if (impact.status !== "applied" || impact.budgetPeriodId !== active.id) continue;
      const transaction = transactions.get(impact.budgetTransactionId)!;
      if (transaction.status !== "posted") continue;
      const value = transaction.direction === "outflow" ? impact.amount : -impact.amount;
      netByCategory.set(impact.budgetCategoryId, (netByCategory.get(impact.budgetCategoryId) ?? 0) + value);
    }
    const plans = data.budgetPeriodCategories.filter((row) => row.budgetPeriodId === active.id);
    expect(plans.some((row) => (netByCategory.get(row.budgetCategoryId) ?? 0) > row.allocatedAmount || (netByCategory.get(row.budgetCategoryId) ?? 0) >= Math.floor(row.allocatedAmount * 0.9))).toBe(true);
    expect(plans.some((row) => (netByCategory.get(row.budgetCategoryId) ?? 0) < row.allocatedAmount)).toBe(true);
    expect(data.budgetPersonalExpenseSources.some((row) => {
      const transaction = transactions.get(row.budgetTransactionId)!;
      return transaction.occurredOn >= activeStartsOn && transaction.occurredOn <= activeEndsOn;
    })).toBe(true);
    expect(data.budgetGroupExpenseSources.some((row) => {
      const transaction = transactions.get(row.budgetTransactionId)!;
      return transaction.occurredOn >= activeStartsOn && transaction.occurredOn <= activeEndsOn;
    })).toBe(true);
    expect(data.budgetTransactions.some((row) => row.origin === "recurring" && row.occurredOn >= activeStartsOn && row.occurredOn <= activeEndsOn)).toBe(true);
    expect(data.budgetTransactions.some((row) => row.occurredOn >= "2026-09-24" && row.occurredOn <= activeEndsOn)).toBe(true);
  });

  it("preserves historical overspend stress coverage", () => {
    const { data } = activeSummary();
    const transactions = new Map(data.budgetTransactions.map((row) => [row.id, row]));
    const netByPeriod = new Map<string, number>();
    for (const impact of data.budgetImpacts) {
      if (impact.status !== "applied" || !impact.budgetPeriodId) continue;
      const transaction = transactions.get(impact.budgetTransactionId)!;
      if (transaction.status !== "posted") continue;
      const value = transaction.direction === "outflow" ? impact.amount : -impact.amount;
      netByPeriod.set(impact.budgetPeriodId, (netByPeriod.get(impact.budgetPeriodId) ?? 0) + value);
    }
    const historical = data.budgetPeriods.filter((period) => period.status !== "active");
    const overspent = historical.some((period) => (netByPeriod.get(period.id) ?? 0) > period.totalBudget);
    expect(overspent).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    expect(generateScaleFixture(owner)).toEqual(generateScaleFixture(owner));
  });
});
