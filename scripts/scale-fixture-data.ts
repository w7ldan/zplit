import { createHash } from "node:crypto";
import { splitBudgetAmount } from "../src/domain/budgeting/spread";

export const SCALE_FIXTURE_SEED = 0x05ca1e;
export const SCALE_FIXTURE_DATABASE = "zplit_scale_test";
export const SCALE_FIXTURE_CONFIRMATION = "scale-test-only";
export const SCALE_FIXTURE_COUNTS = {
  friends: 100,
  activeFriends: 80,
  archivedFriends: 20,
  linkedFriends: 10,
  trips: 12,
  outings: 300,
  expenses: 2_000,
  expenseShares: 5_792,
  repayments: 1_000,
  repaymentAllocations: 429,
  receipts: 8,
  secondaryUsers: 36,
  friendConnections: 10,
  groups: 24,
  groupParticipants: 238,
  groupMemberships: 178,
  groupExpenses: 1_210,
  groupExpenseShares: 3_017,
  groupObligations: 2_154,
  groupSettlements: 315,
  groupSettlementApplications: 393,
  groupOffsets: 23,
  groupOffsetApplications: 37,
  groupExpenseReceipts: 45,
  groupSettlementProofs: 14,
  groupExpenseLifecycleEvents: 1_641,
  groupJoinRequests: 6,
  organizations: 10,
  organizationParticipants: 178,
  organizationMemberships: 136,
  organizationInvitations: 8,
  organizationFriends: 112,
  organizationOutings: 86,
  organizationExpenses: 240,
  organizationExpenseShares: 478,
  organizationRepayments: 118,
  organizationRepaymentAllocations: 79,
  organizationReceipts: 12,
  budgetPeriods: 20,
  budgetCategories: 15,
  budgetPeriodCategories: 186,
  budgetTransactions: 3_147,
  budgetImpacts: 3_008,
  budgetPersonalExpenseSources: 461,
  budgetPersonalRepaymentSources: 118,
  budgetGroupExpenseSources: 162,
  budgetGroupSettlementSources: 10,
  budgetGroupObligationClassifications: 5,
  recurringTemplates: 75,
  activeRecurringTemplates: 60,
  recurringOccurrences: 390,
  notifications: 260,
  chatThreads: 34,
  chatMessages: 2_024,
  chatThreadReads: 12,
} as const;

const createdAt = "2026-01-01T00:00:00.000Z";
const kindCodes = {
  friend: "001",
  outing: "002",
  expense: "003",
  share: "004",
  repayment: "005",
  receipt: "006",
  group: "010",
  groupParticipant: "011",
  groupExpense: "012",
  groupShare: "013",
  obligation: "014",
  settlement: "015",
  settlementApp: "016",
  offset: "017",
  offsetApp: "018",
  groupReceipt: "019",
  groupLifecycle: "020",
  org: "021",
  orgParticipant: "022",
  orgInvitation: "023",
  budgetPeriod: "024",
  budgetCategory: "025",
  budgetTransaction: "026",
  budgetImpact: "027",
  recurringTemplate: "028",
  occurrence: "029",
  notification: "030",
  chatThread: "031",
  chatMessage: "032",
  settlementProof: "033",
  groupJoinRequest: "034",
  trip: "035",
  orgFriend: "036",
  orgOuting: "037",
  orgExpense: "038",
  orgShare: "039",
  orgRepayment: "040",
  orgReceipt: "041",
} as const;

export type FixtureIdKind = keyof typeof kindCodes;

export type FixtureFriend = {
  id: string;
  userId: string;
  linkedUserId: string | null;
  name: string;
  phoneNumber: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureTrip = {
  id: string;
  userId: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureOuting = {
  id: string;
  userId: string;
  tripId: string | null;
  title: string;
  occurredAt: Date;
  occurredOn: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureExpense = {
  id: string;
  userId: string;
  outingId: string;
  description: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureExpenseShare = {
  id: string;
  userId: string;
  expenseId: string;
  friendId: string;
  amountOwed: number;
  createdAt: Date;
};

export type FixtureRepayment = {
  id: string;
  userId: string;
  friendId: string;
  amount: number;
  paidAt: Date;
  paidOn: string;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
};

export type FixtureRepaymentAllocation = {
  userId: string;
  repaymentId: string;
  expenseShareId: string;
  amount: number;
  createdAt: Date;
};

export type FixtureReceipt = {
  id: string;
  userId: string;
  expenseId: string;
  originalFilename: string;
  mediaType: "image/png";
  byteSize: number;
  sha256: string;
  content: Buffer;
  createdAt: Date;
};

export type ScaleFixtureData = {
  seed: number;
  userId: string;
  friends: FixtureFriend[];
  trips: FixtureTrip[];
  outings: FixtureOuting[];
  expenses: FixtureExpense[];
  expenseShares: FixtureExpenseShare[];
  repayments: FixtureRepayment[];
  repaymentAllocations: FixtureRepaymentAllocation[];
  receipts: FixtureReceipt[];
  secondaryUsers: FixtureSecondaryUser[];
  friendConnections: FixtureFriendConnection[];
  groups: FixtureGroup[];
  groupParticipants: FixtureGroupParticipant[];
  groupMemberships: FixtureGroupMembership[];
  groupExpenses: FixtureGroupExpense[];
  groupExpenseShares: FixtureGroupExpenseShare[];
  groupObligations: FixtureGroupObligation[];
  groupSettlements: FixtureGroupSettlement[];
  groupSettlementApplications: FixtureGroupSettlementApplication[];
  groupOffsets: FixtureGroupOffset[];
  groupOffsetApplications: FixtureGroupOffsetApplication[];
  groupExpenseReceipts: FixtureGroupReceipt[];
  groupSettlementProofs: FixtureGroupSettlementProof[];
  groupExpenseLifecycleEvents: FixtureGroupLifecycleEvent[];
  groupJoinRequests: FixtureGroupJoinRequest[];
  organizations: FixtureOrganization[];
  organizationScopes: FixtureOrganizationScope[];
  organizationParticipants: FixtureOrganizationParticipant[];
  organizationMemberships: FixtureOrganizationMembership[];
  organizationInvitations: FixtureOrganizationInvitation[];
  organizationFriends: FixtureFriend[];
  organizationOutings: FixtureOuting[];
  organizationExpenses: FixtureExpense[];
  organizationExpenseShares: FixtureExpenseShare[];
  organizationRepayments: FixtureRepayment[];
  organizationRepaymentAllocations: FixtureRepaymentAllocation[];
  organizationReceipts: FixtureReceipt[];
  budgetPeriods: FixtureBudgetPeriod[];
  budgetCategories: FixtureBudgetCategory[];
  budgetPeriodCategories: FixtureBudgetPeriodCategory[];
  budgetTransactions: FixtureBudgetTransaction[];
  budgetImpacts: FixtureBudgetImpact[];
  budgetPersonalExpenseSources: FixtureBudgetPersonalExpenseSource[];
  budgetPersonalRepaymentSources: FixtureBudgetPersonalRepaymentSource[];
  budgetGroupExpenseSources: FixtureBudgetGroupExpenseSource[];
  budgetGroupSettlementSources: FixtureBudgetGroupSettlementSource[];
  budgetGroupObligationClassifications: FixtureBudgetGroupObligationClassification[];
  recurringTemplates: FixtureBudgetRecurringTemplate[];
  recurringOccurrences: FixtureBudgetRecurringOccurrence[];
  chatThreads: FixtureChatThread[];
  chatMessages: FixtureChatMessage[];
  chatThreadReads: FixtureChatThreadRead[];
  notifications: FixtureNotification[];
};

export const SCALE_FIXTURE_SCENARIO_IDS = {
  noSharesExpenseId: fixtureId("expense", 0),
  fullyPaidExpenseId: fixtureId("expense", 1),
  partiallyPaidExpenseId: fixtureId("expense", 2),
  unpaidExpenseId: fixtureId("expense", 3),
  overpaidRepaymentId: fixtureId("repayment", 3),
  unallocatedRepaymentId: fixtureId("repayment", 4),
  severalFriendsExpenseId: fixtureId("expense", 1),
} as const;

export function fixtureId(kind: FixtureIdKind, index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffffffff) throw new Error("fixture ID index is out of range");
  const code = kindCodes[kind];
  const hexIndex = index.toString(16).padStart(12, "0");
  return `5ca1e${code}-0000-4${code}-8${code}-${hexIndex}`;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1 | state);
    let value = state ^ (state >>> 15);
    value = Math.imul(value, 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Uniform deterministic stream for the full-product fixture. The legacy
// random() above is preserved exactly for the Personal fixture (its outputs
// are pinned by existing counts), but it collapses into a narrow attractor
// after a few draws and cannot drive threshold distributions.
function randomUniform(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function integer(next: () => number, maximum: number) {
  return Math.floor(next() * maximum);
}

function date(value: string) {
  return new Date(value);
}

function copyDate(value: Date) {
  return new Date(value.getTime());
}

function outingTimestamp(index: number, next: () => number) {
  if (index === 0) return date("2026-01-31T23:59:59.999Z");
  if (index === 1) return date("2026-02-01T00:00:00.000Z");
  if (index === 2) return date("2026-03-01T00:00:00.000+14:00");
  // 36-month window from October 2023 through September 2026 so the active
  // Budget period contains linked Personal activity. Boundary indices above
  // preserve the month-end, midnight, and +14:00 timezone edge shapes.
  const shifted = (index % 36) + 9;
  return new Date(Date.UTC(
    2023 + Math.floor(shifted / 12),
    shifted % 12,
    1 + integer(next, 27),
    integer(next, 24),
    integer(next, 60),
    integer(next, 60),
  ));
}

function repaymentTimestamp(index: number, next: () => number) {
  if (index === 0) return date("2024-03-31T23:59:59.999Z");
  if (index === 1) return date("2024-04-01T00:00:00.000Z");
  if (index === 2) return date("2024-05-01T00:00:00.000+08:00");
  return new Date(Date.UTC(
    2023 + (index % 4),
    index % 12,
    1 + integer(next, 27),
    integer(next, 24),
    integer(next, 60),
  ));
}

function friendIndexesForExpense(index: number, count: number) {
  const special: Record<number, number[]> = {
    1: [0, 1],
    2: [2, 3],
    3: [4],
    4: [5],
  };
  if (special[index]) return special[index];
  const indexes: number[] = [];
  for (let offset = 0; indexes.length < count; offset += 1) {
    const candidate = (index * 17 + offset * 23 + 7) % SCALE_FIXTURE_COUNTS.friends;
    if (!indexes.includes(candidate)) indexes.push(candidate);
  }
  return indexes;
}

function specialShareAmounts(index: number) {
  return {
    1: [3_000, 4_000],
    2: [6_000, 5_000],
    3: [7_000],
    4: [8_000],
  }[index];
}

function receiptContent() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
}

export function secondaryUserId(index: number) {
  return `scale-collab-${String(index + 1).padStart(3, "0")}`;
}

function generateFriends(userId: string, fixedCreatedAt: Date) {
  const friends: FixtureFriend[] = [];
  for (let index = 0; index < SCALE_FIXTURE_COUNTS.friends; index += 1) {
    friends.push({
      id: fixtureId("friend", index),
      userId,
      linkedUserId: index >= 10 && index < 10 + SCALE_FIXTURE_COUNTS.linkedFriends ? secondaryUserId(index - 10) : null,
      name: index === 0 ? "Long friend " + "x".repeat(108) : "Scale friend " + String(index + 1).padStart(3, "0"),
      phoneNumber: index % 3 === 0 ? "+62812" + String(index).padStart(6, "0") : null,
      notes: index % 4 === 0 ? "Fixture contact with notes for list and detail rendering." : null,
      archivedAt: index < SCALE_FIXTURE_COUNTS.activeFriends ? null : new Date(Date.UTC(2025, index % 12, 15, 9)),
      createdAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    });
  }
  return friends;
}

const SCALE_TRIP_NAMES = [
  "Japan Trip 2026",
  "Jakarta Weekend",
  "Bali Retreat",
  "Bandung Workation",
  "Yogyakarta Heritage",
  "Surabaya Family",
  "Lombok Escape",
  "Medan Culinary",
  "Semarang Business",
  "Makassar Sailing",
  "Malang Highlands",
  "Bogor Getaway",
];

function generateTrips(userId: string, fixedCreatedAt: Date) {
  return SCALE_TRIP_NAMES.slice(0, SCALE_FIXTURE_COUNTS.trips).map((name, index) => ({
    id: fixtureId("trip", index),
    userId,
    name,
    startsOn: `2025-${String((index % 12) + 1).padStart(2, "0")}-05`,
    endsOn: `2025-${String((index % 12) + 1).padStart(2, "0")}-09`,
    notes: index % 3 === 0 ? "Fixture trip grouping related outings." : null,
    createdAt: copyDate(fixedCreatedAt),
    updatedAt: copyDate(fixedCreatedAt),
  }));
}

function generateOutings(userId: string, fixedCreatedAt: Date, next: () => number, trips: FixtureTrip[]) {
  const outings: FixtureOuting[] = [];
  for (let index = 0; index < SCALE_FIXTURE_COUNTS.outings; index += 1) {
    const occurredAt = outingTimestamp(index, next);
    outings.push({
      id: fixtureId("outing", index),
      userId,
      tripId: index >= 3 && index % 5 === 0 ? trips[index % trips.length]!.id : null,
      title: index === 0 ? "Long outing " + "y".repeat(148) : "Scale outing " + String(index + 1).padStart(3, "0"),
      occurredAt,
      occurredOn: occurredAt.toISOString().slice(0, 10),
      notes: index % 6 === 0 ? "Historical fixture outing for list, filtering, and timeline rendering." : null,
      createdAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    });
  }
  return outings;
}

function generateExpenses(userId: string, friends: FixtureFriend[], outings: FixtureOuting[], fixedCreatedAt: Date, next: () => number) {
  const expenses: FixtureExpense[] = [];
  const expenseShares: FixtureExpenseShare[] = [];
  for (let index = 0; index < SCALE_FIXTURE_COUNTS.expenses; index += 1) {
    const amount = index < 5 ? [12_000, 18_000, 22_000, 24_000, 26_000][index]! : 10_000 + integer(next, 90_001);
    expenses.push({
      id: fixtureId("expense", index),
      userId,
      outingId: outings[index % outings.length]!.id,
      description: index === 0 ? "Long expense " + "z".repeat(187) : "Scale expense " + String(index + 1).padStart(4, "0"),
      amount,
      createdAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    });

    const shareCount = index === 0 ? 0 : index < 5 ? friendIndexesForExpense(index, 1).length : index % 10 === 0 ? 0 : 1 + (index % 5);
    const friendIndexes = friendIndexesForExpense(index, shareCount);
    const specialAmounts = specialShareAmounts(index);
    const totalOwed = specialAmounts?.reduce((sum, value) => sum + value, 0) ?? Math.floor(amount * (20 + (index % 7) * 7) / 100);
    let remaining = totalOwed;
    const weights = friendIndexes.map((_, offset) => 1 + ((index + offset * 3) % 7));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    for (let offset = 0; offset < friendIndexes.length; offset += 1) {
      const amountOwed = specialAmounts?.[offset] ?? (offset === friendIndexes.length - 1 ? remaining : Math.max(1, Math.floor(totalOwed * weights[offset]! / weightTotal)));
      remaining -= amountOwed;
      expenseShares.push({
        id: fixtureId("share", expenseShares.length),
        userId,
        expenseId: expenses[index]!.id,
        friendId: friends[friendIndexes[offset]!]!.id,
        amountOwed,
        createdAt: copyDate(fixedCreatedAt),
      });
    }
  }
  return { expenses, expenseShares };
}

function generateRepayments(userId: string, friends: FixtureFriend[], expenses: FixtureExpense[], expenseShares: FixtureExpenseShare[], fixedCreatedAt: Date, next: () => number) {
  const repayments: FixtureRepayment[] = [];
  const repaymentAllocations: FixtureRepaymentAllocation[] = [];
  const sharesByFriend = new Map<string, FixtureExpenseShare[]>();
  const remainingByShare = new Map<string, number>();
  for (const share of expenseShares) {
    const shares = sharesByFriend.get(share.friendId) ?? [];
    shares.push(share);
    sharesByFriend.set(share.friendId, shares);
    remainingByShare.set(share.id, share.amountOwed);
  }
  const shareFor = (expenseIndex: number, friendIndex: number) => {
    const expenseId = expenses[expenseIndex]!.id;
    const friendId = friends[friendIndex]!.id;
    const share = expenseShares.find((candidate) => candidate.expenseId === expenseId && candidate.friendId === friendId);
    if (!share) throw new Error("scale fixture scenario share is missing");
    return share;
  };
  const reservedShareIds = new Set<string>();
  const addRepayment = (index: number, friendIndex: number, amount: number, allocation?: { share: FixtureExpenseShare; amount: number }) => {
    const repaymentId = fixtureId("repayment", index);
    const paidAt = repaymentTimestamp(index, next);
    repayments.push({
      id: repaymentId,
      userId,
      friendId: friends[friendIndex]!.id,
      amount,
      paidAt,
      paidOn: paidAt.toISOString().slice(0, 10),
      paymentMethod: ["cash", "bank transfer", "mobile transfer", "card"][index % 4]!,
      notes: index < 5 ? "Deterministic scale fixture scenario" : null,
      createdAt: copyDate(fixedCreatedAt),
    });
    if (!allocation) return;
    repaymentAllocations.push({ userId, repaymentId, expenseShareId: allocation.share.id, amount: allocation.amount, createdAt: copyDate(fixedCreatedAt) });
    remainingByShare.set(allocation.share.id, remainingByShare.get(allocation.share.id)! - allocation.amount);
    reservedShareIds.add(allocation.share.id);
  };

  const fullyPaidFirstShare = shareFor(1, 0);
  const fullyPaidSecondShare = shareFor(1, 1);
  const partiallyPaidShare = shareFor(2, 2);
  const unpaidShare = shareFor(3, 4);
  const overpaidShare = shareFor(4, 5);
  addRepayment(0, 0, fullyPaidFirstShare.amountOwed, { share: fullyPaidFirstShare, amount: fullyPaidFirstShare.amountOwed });
  addRepayment(1, 1, fullyPaidSecondShare.amountOwed, { share: fullyPaidSecondShare, amount: fullyPaidSecondShare.amountOwed });
  addRepayment(2, 2, 2_000, { share: partiallyPaidShare, amount: 2_000 });
  addRepayment(3, 5, overpaidShare.amountOwed + 2_000, { share: overpaidShare, amount: overpaidShare.amountOwed });
  addRepayment(4, 6, 5_000);
  reservedShareIds.add(partiallyPaidShare.id);
  reservedShareIds.add(unpaidShare.id);

  for (let index = 5; index < SCALE_FIXTURE_COUNTS.repayments; index += 1) {
    const friendIndex = (index * 19 + 11) % SCALE_FIXTURE_COUNTS.activeFriends;
    const amount = 3_000 + integer(next, 17_001);
    const repaymentId = fixtureId("repayment", index);
    const paidAt = repaymentTimestamp(index, next);
    repayments.push({
      id: repaymentId,
      userId,
      friendId: friends[friendIndex]!.id,
      amount,
      paidAt,
      paidOn: paidAt.toISOString().slice(0, 10),
      paymentMethod: ["cash", "bank transfer", "mobile transfer", "card"][index % 4]!,
      notes: null,
      createdAt: copyDate(fixedCreatedAt),
    });
    let budget = amount;
    const maxAllocations = index % 4 === 0 ? 0 : 1 + (index % 3);
    for (const share of (sharesByFriend.get(friends[friendIndex]!.id) ?? []).slice(0, maxAllocations)) {
      const remainingShare = remainingByShare.get(share.id) ?? 0;
      if (reservedShareIds.has(share.id) || remainingShare <= 0 || budget <= 0) continue;
      const allocationAmount = Math.min(remainingShare, budget, 500 + ((index * 1_237 + share.amountOwed) % 5_001));
      if (allocationAmount <= 0) continue;
      repaymentAllocations.push({ userId, repaymentId, expenseShareId: share.id, amount: allocationAmount, createdAt: copyDate(fixedCreatedAt) });
      remainingByShare.set(share.id, remainingShare - allocationAmount);
      budget -= allocationAmount;
    }
  }
  return { repayments, repaymentAllocations };
}

function generateReceipts(userId: string, expenses: FixtureExpense[], fixedCreatedAt: Date) {
  return [0, 1, 2, 3, 4, 120, 1_200, 1_999].map((expenseIndex, index) => {
    const content = receiptContent();
    return {
      id: fixtureId("receipt", index),
      userId,
      expenseId: expenses[expenseIndex]!.id,
      originalFilename: "scale-receipt-" + String(index + 1).padStart(2, "0") + ".png",
      mediaType: "image/png" as const,
      byteSize: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
      createdAt: copyDate(fixedCreatedAt),
    } satisfies FixtureReceipt;
  });
}

export function generateScaleFixture(userId = "scale-fixture-user", seed = SCALE_FIXTURE_SEED): ScaleFixtureData {
  if (!userId.trim()) throw new Error("userId is required");
  if (!Number.isInteger(seed)) throw new Error("seed must be an integer");
  const next = random(seed);
  const fixedCreatedAt = date(createdAt);
  const friends = generateFriends(userId, fixedCreatedAt);
  const trips = generateTrips(userId, fixedCreatedAt);
  const outings = generateOutings(userId, fixedCreatedAt, next, trips);
  const { expenses, expenseShares } = generateExpenses(userId, friends, outings, fixedCreatedAt, next);
  const { repayments, repaymentAllocations } = generateRepayments(userId, friends, expenses, expenseShares, fixedCreatedAt, next);
  const receipts = generateReceipts(userId, expenses, fixedCreatedAt);
  const secondaryUsers = generateSecondaryUsers(fixedCreatedAt);
  const groups = generateGroups(userId, fixedCreatedAt, secondaryUsers, seed);
  const organizations = generateOrganizations(userId, fixedCreatedAt, secondaryUsers, friends, seed);
  const budget = generateBudget(userId, fixedCreatedAt, outings, expenses, repayments, groups, seed);
  const chat = generateChat(userId, fixedCreatedAt, secondaryUsers, groups, organizations, seed);
  const notifications = generateNotifications(userId, fixedCreatedAt, friends, groups, organizations, seed);
  const friendConnections = generateFriendConnections(userId, secondaryUsers);
  return {
    seed,
    userId,
    friends,
    trips,
    outings,
    expenses,
    expenseShares,
    repayments,
    repaymentAllocations,
    receipts,
    secondaryUsers,
    friendConnections,
    ...groups,
    ...organizations,
    ...budget,
    ...chat,
    notifications,
  };
}

// ---------------------------------------------------------------------------
// Full-product scale fixture: secondary users, Groups, Organizations, Budget,
// collaboration. Personal generation above is preserved exactly (same seed
// stream and order); every domain below uses an independent stream so the
// Personal fixture never shifts when collaboration volumes change.
// ---------------------------------------------------------------------------

export type FixtureSecondaryUser = {
  id: string;
  name: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureFriendConnection = {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
  connectedAt: Date;
  updatedAt: Date;
};

export type FixtureGroup = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureGroupParticipant = {
  id: string;
  groupId: string;
  userId: string | null;
  displayName: string | null;
  label: string | null;
  sourcePersonalFriendId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureGroupMembership = {
  groupId: string;
  userId: string;
  participantId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Date;
};

export type FixtureGroupExpense = {
  id: string;
  groupId: string;
  creatorParticipantId: string;
  payerParticipantId: string;
  description: string;
  occurredAt: Date;
  occurredOn: string;
  totalAmount: number;
  state: "pending" | "confirmed" | "rejected" | "voided";
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureGroupExpenseShare = {
  id: string;
  groupId: string;
  expenseId: string;
  participantId: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureGroupObligation = {
  id: string;
  groupId: string;
  sourceExpenseId: string;
  sourceShareId: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  originalAmount: number;
  voidedAt: Date | null;
  createdAt: Date;
};

export type FixtureGroupSettlement = {
  id: string;
  groupId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  amount: number;
  paymentMethod: string;
  state: "pending" | "confirmed";
  paidOn: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
};

export type FixtureGroupSettlementApplication = {
  id: string;
  groupId: string;
  settlementId: string;
  obligationId: string;
  appliedAmount: number;
  createdAt: Date;
};

export type FixtureGroupOffset = {
  id: string;
  groupId: string;
  initiatorParticipantId: string;
  counterpartyParticipantId: string;
  amount: number;
  state: "pending" | "confirmed";
  createdAt: Date;
  confirmedAt: Date | null;
};

export type FixtureGroupOffsetApplication = {
  id: string;
  groupId: string;
  offsetSettlementId: string;
  obligationId: string;
  appliedAmount: number;
  createdAt: Date;
};

export type FixtureGroupLifecycleEvent = {
  id: string;
  groupId: string;
  expenseId: string;
  eventType: "created" | "payer_confirmed" | "payer_rejected" | "voided";
  actorUserId: string;
  fromState: "pending" | "confirmed" | null;
  toState: "pending" | "confirmed" | "rejected" | "voided";
  createdAt: Date;
};

export type FixtureGroupReceipt = {
  id: string;
  groupId: string;
  expenseId: string;
  originalFilename: string;
  mediaType: "image/png";
  byteSize: number;
  sha256: string;
  content: Buffer;
  createdAt: Date;
};

export type FixtureGroupSettlementProof = {
  id: string;
  groupId: string;
  settlementId: string;
  originalFilename: string;
  mediaType: "image/png";
  byteSize: number;
  sha256: string;
  content: Buffer;
  createdAt: Date;
};

export type FixtureGroupJoinRequest = {
  id: string;
  groupId: string;
  kind: "member_invitation" | "participant_link";
  participantId: string | null;
  participantDisplayNameSnapshot: string | null;
  participantLabelSnapshot: string | null;
  targetUserId: string;
  requesterUserId: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  expiredAt: Date | null;
};

export type ScaleGroupFixture = {
  groups: FixtureGroup[];
  groupParticipants: FixtureGroupParticipant[];
  groupMemberships: FixtureGroupMembership[];
  groupExpenses: FixtureGroupExpense[];
  groupExpenseShares: FixtureGroupExpenseShare[];
  groupObligations: FixtureGroupObligation[];
  groupSettlements: FixtureGroupSettlement[];
  groupSettlementApplications: FixtureGroupSettlementApplication[];
  groupOffsets: FixtureGroupOffset[];
  groupOffsetApplications: FixtureGroupOffsetApplication[];
  groupExpenseReceipts: FixtureGroupReceipt[];
  groupSettlementProofs: FixtureGroupSettlementProof[];
  groupExpenseLifecycleEvents: FixtureGroupLifecycleEvent[];
  groupJoinRequests: FixtureGroupJoinRequest[];
};

const SCALE_SECONDARY_NAMES = [
  "Ayu Lestari", "Bima Prasetyo", "Citra Dewi", "Dimas Saputra", "Eka Putri",
  "Fajar Nugroho", "Gita Puspita", "Hendra Gunawan", "Intan Permata", "Joko Susilo",
  "Kirana Wulandari", "Lukman Hakim", "Mega Anggraini", "Nanda Pratama", "Olivia Tan",
  "Pandu Winata", "Qori Amelia", "Raka Aditya", "Salsaabila", "Taufik Hidayat",
  "Utami Sari", "Vino Bastian", "Wulan Dari", "Yoga Firmansyah", "Zahra Nabila",
  "Arif Rahman", "Bella Swan", "Candra Wijaya", "Dinda Kirana", "Eko Purnomo",
  "Farah Quinn", "Gilang Ramadhan", "Hana Yuliana", "Ilham Maulana", "Jihan Aulia",
  "Krisna Bayu",
];

export function generateSecondaryUsers(fixedCreatedAt: Date): FixtureSecondaryUser[] {
  return SCALE_SECONDARY_NAMES.slice(0, SCALE_FIXTURE_COUNTS.secondaryUsers).map((name, index) => ({
    id: secondaryUserId(index),
    name,
    email: `scale-member-${String(index + 1).padStart(3, "0")}@example.invalid`,
    username: `scalem${String(index + 1).padStart(3, "0")}`,
    createdAt: copyDate(fixedCreatedAt),
    updatedAt: copyDate(fixedCreatedAt),
  }));
}

export function generateFriendConnections(ownerUserId: string, secondaryUsers: FixtureSecondaryUser[]): FixtureFriendConnection[] {
  const fixedCreatedAt = date(createdAt);
  return secondaryUsers.slice(0, SCALE_FIXTURE_COUNTS.friendConnections).map((user, index) => {
    const pair = [ownerUserId, user.id].sort();
    return {
      id: fixtureId("groupLifecycle", 9000 + index),
      userAId: pair[0]!,
      userBId: pair[1]!,
      createdAt: copyDate(fixedCreatedAt),
      connectedAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    };
  });
}

export const SCALE_GROUP_ANCHORS = [
  "Jakarta Weekend",
  "Japan Trip 2026",
  "Fasilkom Study Group",
  "Apartment Split",
  "Design Committee",
  "Engineering Committee",
  "Archived Club",
  "Quiet Reading Club",
] as const;

const SCALE_EXTERNAL_NAMES = [
  "Budi Santoso", "Sinta Maharani", "Rudi Hartono", "Maya Putri", "Agus Wijaya",
  "Dewi Lestari", "Joko Prasetyo", "Putri Ayu", "Andi Nugraha", "Nina Kurnia",
  "Budi Kos", "Sinta Kantor", "Pak RT", "Tetangga Sebelah", "Teman Fasilkom",
  "Rekan Kantor", "Keponakan", "Supir Travel",
];

const SCALE_EXTERNAL_LABELS = ["Fasilkom", "Office", "Kos", "Keluarga", null, null, "Komunitas", null];

const SCALE_GROUP_DESCRIPTIONS: Record<string, string[]> = {
  "Japan Trip 2026": ["Shinkansen Osaka", "Hotel Tokyo", "Konbini", "Ramen Ichiran", "Tiket museum", "Suica top-up", "Oleh-oleh Donki", "Karaoke", "Onsen", "Takoyaki"],
  "Jakarta Weekend": ["MRT", "KRL", "Ngopi Senopati", "Makan Blok M", "Parkir mal", "Tol dalam kota", "Ojek", "Sarapan"],
  "Fasilkom Study Group": ["Fotokopi diktat", "Iuran kelas", "Konsumsi belajar", "Print laporan", "Sewa proyektor", "Kas angkatan"],
  "Apartment Split": ["Listrik", "Air", "Iuran kebersihan", "Galon", "Internet", "Perbaikan AC", "Keamanan", "Parkir bulanan"],
};

const SCALE_GENERIC_EXPENSE_TITLES = [
  "Makan malam", "Kopi sore", "Bensin patungan", "Tiket kereta", "Parkir",
  "Tol", "Belanja bulanan", "Konsumsi rapat", "Sewa villa", "Iuran",
  "Oleh-oleh", "Laundry", "Pulsa", "Langganan", "Servis motor",
  "Fotokopi", "Cetak dokumen", "Hadiah", "Donasi", "Jajan pasar",
];

function groupDescriptionPool(name: string) {
  return SCALE_GROUP_DESCRIPTIONS[name] ?? SCALE_GENERIC_EXPENSE_TITLES;
}

type GroupPlan = {
  name: string;
  registeredCount: number;
  externalCount: number;
  expenses: number;
  settlementQuota: number;
  offsets: number;
  includeOwner: boolean;
  archived: boolean;
  settleAll: boolean;
  pendingClaims: number;
};

function groupPlans(): GroupPlan[] {
  const plans: GroupPlan[] = [
    { name: "Jakarta Weekend", registeredCount: 6, externalCount: 1, expenses: 46, settlementQuota: 15, offsets: 2, includeOwner: true, archived: false, settleAll: false, pendingClaims: 2 },
    { name: "Japan Trip 2026", registeredCount: 34, externalCount: 6, expenses: 380, settlementQuota: 110, offsets: 6, includeOwner: true, archived: false, settleAll: false, pendingClaims: 4 },
    { name: "Fasilkom Study Group", registeredCount: 8, externalCount: 1, expenses: 40, settlementQuota: 12, offsets: 2, includeOwner: true, archived: false, settleAll: false, pendingClaims: 6 },
    { name: "Apartment Split", registeredCount: 5, externalCount: 0, expenses: 52, settlementQuota: 4, offsets: 2, includeOwner: true, archived: false, settleAll: false, pendingClaims: 0 },
    { name: "Design Committee", registeredCount: 7, externalCount: 1, expenses: 44, settlementQuota: 60, offsets: 2, includeOwner: true, archived: false, settleAll: true, pendingClaims: 0 },
    { name: "Engineering Committee", registeredCount: 6, externalCount: 4, expenses: 38, settlementQuota: 10, offsets: 2, includeOwner: true, archived: false, settleAll: false, pendingClaims: 2 },
    { name: "Archived Club", registeredCount: 5, externalCount: 1, expenses: 30, settlementQuota: 8, offsets: 0, includeOwner: true, archived: true, settleAll: false, pendingClaims: 0 },
    { name: "Quiet Reading Club", registeredCount: 3, externalCount: 1, expenses: 4, settlementQuota: 2, offsets: 0, includeOwner: false, archived: false, settleAll: false, pendingClaims: 0 },
  ];
  const sizes = [4, 6, 8, 10, 12, 14, 5, 7, 9, 11, 13, 6, 8, 10, 12, 14];
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index]!;
    plans.push({
      name: `Scale group ${String(plans.length + 1).padStart(3, "0")}`,
      registeredCount: Math.max(2, size - 2),
      externalCount: Math.min(2, size - Math.max(2, size - 2)),
      expenses: 36,
      settlementQuota: 8,
      offsets: index < 4 ? 2 : 0,
      includeOwner: true,
      archived: false,
      settleAll: false,
      pendingClaims: 0,
    });
  }
  return plans;
}

type GroupBuildState = {
  userCursor: number;
  expense: number;
  share: number;
  obligation: number;
  settlement: number;
  settlementApp: number;
  offset: number;
  offsetApp: number;
  receipt: number;
  proof: number;
  lifecycle: number;
};

type GroupIdentities = {
  groupId: string;
  memberParticipantIds: string[];
  registeredParticipantIds: string[];
  participantUser: Map<string, string | null>;
  allParticipantIds: string[];
  ownerParticipantId: string | undefined;
};

function assignGroupIdentities(
  fixture: ScaleGroupFixture,
  plan: GroupPlan,
  groupIndex: number,
  ownerUserId: string,
  secondaryUsers: FixtureSecondaryUser[],
  fixedCreatedAt: Date,
  state: GroupBuildState,
): GroupIdentities {
  const groupId = fixtureId("group", groupIndex);
  fixture.groups.push({
    id: groupId,
    name: plan.name,
    description: groupIndex < SCALE_GROUP_ANCHORS.length ? `Fixture ${plan.name} for manual UI inspection.` : `Deterministic background group ${groupIndex + 1}.`,
    archivedAt: plan.archived ? new Date(Date.UTC(2026, 2, 15, 9)) : null,
    createdByUserId: plan.includeOwner ? ownerUserId : secondaryUsers[groupIndex % secondaryUsers.length]!.id,
    createdAt: copyDate(fixedCreatedAt),
    updatedAt: copyDate(fixedCreatedAt),
  });
  const registeredUserIds: string[] = [];
  if (plan.includeOwner) registeredUserIds.push(ownerUserId);
  let userGuard = 0;
  while (registeredUserIds.length < plan.registeredCount && userGuard < secondaryUsers.length * 2) {
    const candidate = secondaryUsers[state.userCursor % secondaryUsers.length]!.id;
    state.userCursor += 1;
    userGuard += 1;
    if (!registeredUserIds.includes(candidate)) registeredUserIds.push(candidate);
  }
  const participantByUser = new Map<string, string>();
  const participantUser = new Map<string, string | null>();
  registeredUserIds.forEach((userId) => {
    const participantId = fixtureId("groupParticipant", fixture.groupParticipants.length);
    fixture.groupParticipants.push({
      id: participantId, groupId, userId, displayName: null, label: null,
      sourcePersonalFriendId: null, createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    participantByUser.set(userId, participantId);
    participantUser.set(participantId, userId);
  });
  for (let externalIndex = 0; externalIndex < plan.externalCount; externalIndex += 1) {
    const participantId = fixtureId("groupParticipant", fixture.groupParticipants.length);
    const nameIndex = (groupIndex * 5 + externalIndex * 7) % SCALE_EXTERNAL_NAMES.length;
    fixture.groupParticipants.push({
      id: participantId, groupId, userId: null,
      displayName: SCALE_EXTERNAL_NAMES[nameIndex]!,
      label: SCALE_EXTERNAL_LABELS[(groupIndex + externalIndex) % SCALE_EXTERNAL_LABELS.length]!,
      sourcePersonalFriendId: null, createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    participantUser.set(participantId, null);
  }
  const allParticipantIds = fixture.groupParticipants.filter((row) => row.groupId === groupId).map((row) => row.id);
  const registeredParticipantIds = registeredUserIds.map((userId) => participantByUser.get(userId)!);
  const former = new Set<string>();
  if (registeredParticipantIds.length >= 8) {
    former.add(registeredParticipantIds[registeredParticipantIds.length - 1]!);
    if (registeredParticipantIds.length >= 12) former.add(registeredParticipantIds[registeredParticipantIds.length - 2]!);
  }
  const memberParticipantIds = registeredParticipantIds.filter((id) => !former.has(id));
  const ownerParticipantId = plan.includeOwner ? participantByUser.get(ownerUserId)! : undefined;
  const ownerIsGroupOwner = plan.includeOwner && groupIndex % 3 !== 2;
  registeredUserIds.forEach((userId, memberIndex) => {
    const participantId = participantByUser.get(userId)!;
    if (former.has(participantId)) return;
    const role = (ownerIsGroupOwner ? userId === ownerUserId : memberIndex === 0)
      ? "owner"
      : memberIndex === 1 && registeredUserIds.length >= 5 ? "admin" : "member";
    fixture.groupMemberships.push({ groupId, userId, participantId, role, joinedAt: copyDate(fixedCreatedAt) });
  });
  return { groupId, memberParticipantIds, registeredParticipantIds, participantUser, allParticipantIds, ownerParticipantId };
}

function pickGroupExpenseParties(
  plan: GroupPlan,
  groupIndex: number,
  expenseIndex: number,
  memberParticipantIds: string[],
  ownerParticipantId: string | undefined,
) {
  const creatorId = memberParticipantIds[(expenseIndex * 5 + groupIndex * 3 + 1) % memberParticipantIds.length]!;
  let payerId = creatorId;
  if (plan.pendingClaims > 0 && expenseIndex < plan.pendingClaims && ownerParticipantId) {
    payerId = ownerParticipantId;
  } else if ((expenseIndex + groupIndex) % 10 >= 7 && memberParticipantIds.length > 1) {
    payerId = memberParticipantIds[(expenseIndex * 11 + groupIndex * 7 + 2) % memberParticipantIds.length]!;
    if (payerId === creatorId) payerId = memberParticipantIds[(expenseIndex * 11 + groupIndex * 7 + 3) % memberParticipantIds.length]!;
  }
  const forceActiveLink = ownerParticipantId !== undefined && groupIndex < 6 && expenseIndex % 12 === 4;
  if (forceActiveLink) payerId = ownerParticipantId;
  return { creatorId, payerId, forceActiveLink };
}

function decideGroupExpenseState(
  plan: GroupPlan,
  expenseIndex: number,
  forceActiveLink: boolean,
  next: () => number,
): FixtureGroupExpense["state"] {
  if (forceActiveLink) return "confirmed";
  if (plan.pendingClaims > 0 && expenseIndex < plan.pendingClaims) return "pending";
  const roll = next();
  let state: FixtureGroupExpense["state"] = roll < 0.84 ? "confirmed" : roll < 0.92 ? "pending" : roll < 0.965 ? "rejected" : "voided";
  if (plan.archived && state === "pending") state = "confirmed";
  if (plan.settleAll && state !== "confirmed") state = "confirmed";
  return state;
}

function appendExpenseShareRows(
  fixture: ScaleGroupFixture,
  groupId: string,
  expenseId: string,
  participantIds: string[],
  weights: number[],
  totalAmount: number,
  payerId: string,
  state: FixtureGroupExpense["state"],
  occurredAt: Date,
  counters: GroupBuildState,
) {
  let remaining = totalAmount;
  const total = weightTotal(weights);
  participantIds.forEach((participantId, offset) => {
    const amount = offset === participantIds.length - 1 ? remaining : Math.max(1, Math.floor(totalAmount * weights[offset]! / total));
    remaining -= amount;
    const shareId = fixtureId("groupShare", counters.share);
    counters.share += 1;
    fixture.groupExpenseShares.push({
      id: shareId, groupId, expenseId, participantId, amount,
      createdAt: copyDate(occurredAt), updatedAt: copyDate(occurredAt),
    });
    if (participantId === payerId) return;
    if (state !== "confirmed" && state !== "voided") return;
    fixture.groupObligations.push({
      id: fixtureId("obligation", counters.obligation), groupId,
      sourceExpenseId: expenseId, sourceShareId: shareId,
      debtorParticipantId: participantId, creditorParticipantId: payerId,
      originalAmount: amount,
      voidedAt: state === "voided" ? new Date(occurredAt.getTime() + 5 * 86_400_000) : null,
      createdAt: copyDate(occurredAt),
    });
    counters.obligation += 1;
  });
}

function weightTotal(weights: number[]) {
  return weights.reduce((sum, value) => sum + value, 0);
}

function appendExpenseLifecycle(
  fixture: ScaleGroupFixture,
  groupId: string,
  expenseId: string,
  creatorId: string,
  payerId: string,
  creatorUserId: string,
  payerUserId: string,
  state: FixtureGroupExpense["state"],
  occurredAt: Date,
  counters: GroupBuildState,
) {
  const push = (eventType: FixtureGroupLifecycleEvent["eventType"], actorUserId: string, fromState: FixtureGroupLifecycleEvent["fromState"], toState: FixtureGroupLifecycleEvent["toState"], at: Date) => {
    fixture.groupExpenseLifecycleEvents.push({
      id: fixtureId("groupLifecycle", counters.lifecycle), groupId, expenseId, eventType, actorUserId, fromState, toState, createdAt: copyDate(at),
    });
    counters.lifecycle += 1;
  };
  if (state === "confirmed" && creatorId === payerId) {
    push("created", creatorUserId, null, "confirmed", occurredAt);
    return;
  }
  push("created", creatorUserId, null, creatorId === payerId ? "confirmed" : "pending", occurredAt);
  if (state === "confirmed") push("payer_confirmed", payerUserId, "pending", "confirmed", new Date(occurredAt.getTime() + 86_400_000));
  if (state === "rejected") push("payer_rejected", payerUserId, "pending", "rejected", new Date(occurredAt.getTime() + 86_400_000));
  if (state === "voided") {
    if (creatorId !== payerId) push("payer_confirmed", payerUserId, "pending", "confirmed", new Date(occurredAt.getTime() + 86_400_000));
    push("voided", payerUserId, "confirmed", "voided", new Date(occurredAt.getTime() + 5 * 86_400_000));
  }
}

function appendGroupExpense(
  fixture: ScaleGroupFixture,
  groupId: string,
  plan: GroupPlan,
  groupIndex: number,
  expenseIndex: number,
  identities: GroupIdentities,
  pool: string[],
  next: () => number,
  counters: GroupBuildState,
  groupBaseDate: number,
) {
  const parties = pickGroupExpenseParties(plan, groupIndex, expenseIndex, identities.memberParticipantIds, identities.ownerParticipantId);
  const state = decideGroupExpenseState(plan, expenseIndex, parties.forceActiveLink, next);
  const occurredAt = parties.forceActiveLink
    ? new Date(Date.UTC(2026, 8, 1 + (expenseIndex % 28), 10 + (expenseIndex % 8), 15))
    : new Date(groupBaseDate + ((expenseIndex * 37 + groupIndex * 101) % 820) * 86_400_000 + integer(next, 86_400_000));
  const totalAmount = expenseIndex % 53 === 7
    ? 2_000_000 + integer(next, 4_000_000)
    : expenseIndex % 37 === 5
      ? 5_000 + integer(next, 15_000)
      : 20_000 + integer(next, 480_000);
  const title = pool[(expenseIndex * 3 + groupIndex) % pool.length]!;
  const suffix = expenseIndex >= pool.length ? ` #${Math.floor(expenseIndex / pool.length) + 1}` : "";
  const expenseId = fixtureId("groupExpense", counters.expense);
  counters.expense += 1;
  fixture.groupExpenses.push({
    id: expenseId, groupId, creatorParticipantId: parties.creatorId, payerParticipantId: parties.payerId,
    description: groupIndex === 1 && expenseIndex === 0 ? "Long group expense " + "z".repeat(181) : `${title}${suffix}`,
    occurredAt, occurredOn: occurredAt.toISOString().slice(0, 10), totalAmount, state,
    confirmedAt: state === "confirmed" || state === "voided" ? new Date(occurredAt.getTime() + 86_400_000) : null,
    createdAt: copyDate(occurredAt), updatedAt: copyDate(occurredAt),
  });
  const participantCount = identities.allParticipantIds.length;
  const shareCount = Math.max(1, Math.min(1 + ((groupIndex * 31 + expenseIndex * 7) % 4), participantCount - 1, participantCount));
  const shareParticipantIds: string[] = [];
  const start = (expenseIndex * 13 + groupIndex * 5) % participantCount;
  for (let offset = 0; shareParticipantIds.length < shareCount; offset += 1) {
    const candidate = identities.allParticipantIds[(start + offset) % participantCount]!;
    if (!shareParticipantIds.includes(candidate)) shareParticipantIds.push(candidate);
  }
  if (!shareParticipantIds.includes(parties.payerId) && (expenseIndex + groupIndex) % 3 === 0 && shareCount < participantCount) {
    shareParticipantIds[shareParticipantIds.length - 1] = parties.payerId;
  }
  const weights = shareParticipantIds.map((_, offset) => 1 + ((expenseIndex + offset * 3 + groupIndex) % 5));
  appendExpenseShareRows(fixture, groupId, expenseId, shareParticipantIds, weights, totalAmount, parties.payerId, state, occurredAt, counters);
  const participantUser = identities.participantUser;
  appendExpenseLifecycle(fixture, groupId, expenseId, parties.creatorId, parties.payerId, participantUser.get(parties.creatorId)!, participantUser.get(parties.payerId)!, state, occurredAt, counters);
  if (state === "confirmed" && counters.expense % 22 === 1) {
    const content = receiptContent();
    fixture.groupExpenseReceipts.push({
      id: fixtureId("groupReceipt", counters.receipt), groupId, expenseId,
      originalFilename: `group-receipt-${String(counters.receipt + 1).padStart(3, "0")}.png`,
      mediaType: "image/png", byteSize: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      content, createdAt: copyDate(occurredAt),
    });
    counters.receipt += 1;
  }
}

type ObligationQueueEntry = { obligationId: string; remaining: number; createdOrder: number };

function buildOutstandingMap(fixture: ScaleGroupFixture, groupId: string) {
  const outstanding = new Map<string, ObligationQueueEntry[]>();
  fixture.groupObligations
    .filter((row) => row.groupId === groupId && row.voidedAt === null)
    .forEach((row, order) => {
      const key = `${row.debtorParticipantId}|${row.creditorParticipantId}`;
      outstanding.set(key, [...(outstanding.get(key) ?? []), { obligationId: row.id, remaining: row.originalAmount, createdOrder: order }]);
    });
  return outstanding;
}

function reserveObligation(outstanding: Map<string, ObligationQueueEntry[]>, obligationId: string, amount: number) {
  for (const queue of outstanding.values()) {
    const entry = queue.find((row) => row.obligationId === obligationId);
    if (entry) entry.remaining -= amount;
  }
}

function oldestAvailableObligations(outstanding: Map<string, ObligationQueueEntry[]>, debtor: string, creditor: string) {
  return (outstanding.get(`${debtor}|${creditor}`) ?? []).filter((row) => row.remaining > 0);
}

function availableObligationTotal(outstanding: Map<string, ObligationQueueEntry[]>, debtor: string, creditor: string) {
  return oldestAvailableObligations(outstanding, debtor, creditor).reduce((sum, row) => sum + row.remaining, 0);
}

function appendGroupOffsets(
  fixture: ScaleGroupFixture,
  groupId: string,
  plan: GroupPlan,
  next: () => number,
  counters: GroupBuildState,
  registeredSet: Set<string>,
  outstanding: Map<string, ObligationQueueEntry[]>,
  financialBase: number,
) {
  const usedOffsetPairs = new Set<string>();
  for (let offsetIndex = 0; offsetIndex < plan.offsets; offsetIndex += 1) {
    const directions = [...outstanding.keys()].filter((key) => (outstanding.get(key) ?? []).some((row) => row.remaining > 0));
    let pair: [string, string] | undefined;
    for (const key of directions) {
      const [debtor, creditor] = key.split("|") as [string, string];
      const reverse = outstanding.get(`${creditor}|${debtor}`) ?? [];
      const forward = outstanding.get(key) ?? [];
      const pairKey = [debtor, creditor].sort().join("|");
      if (!registeredSet.has(debtor) || !registeredSet.has(creditor)) continue;
      if (reverse.some((row) => row.remaining > 0) && forward.some((row) => row.remaining > 0) && !usedOffsetPairs.has(pairKey)) {
        pair = [debtor, creditor];
        usedOffsetPairs.add(pairKey);
        break;
      }
    }
    if (!pair) break;
    const [debtor, creditor] = pair;
    const forwardAvail = availableObligationTotal(outstanding, debtor, creditor);
    const reverseAvail = availableObligationTotal(outstanding, creditor, debtor);
    const amount = Math.min(forwardAvail, reverseAvail, 30_000 + integer(next, 120_000));
    if (amount <= 0) continue;
    const confirmed = next() < 0.7;
    const offsetCreatedAt = new Date(financialBase + counters.offset * 600_000);
    const offsetId = fixtureId("offset", counters.offset);
    counters.offset += 1;
    fixture.groupOffsets.push({
      id: offsetId, groupId, initiatorParticipantId: debtor, counterpartyParticipantId: creditor,
      amount, state: confirmed ? "confirmed" : "pending",
      createdAt: copyDate(offsetCreatedAt), confirmedAt: confirmed ? new Date(offsetCreatedAt.getTime() + 300_000) : null,
    });
    if (!confirmed) continue;
    for (const side of [[debtor, creditor], [creditor, debtor]] as const) {
      let remaining = amount;
      for (const entry of oldestAvailableObligations(outstanding, side[0], side[1])) {
        if (remaining <= 0) break;
        const applied = Math.min(entry.remaining, remaining);
        fixture.groupOffsetApplications.push({
          id: fixtureId("offsetApp", counters.offsetApp), groupId, offsetSettlementId: offsetId,
          obligationId: entry.obligationId, appliedAmount: applied, createdAt: copyDate(offsetCreatedAt),
        });
        counters.offsetApp += 1;
        reserveObligation(outstanding, entry.obligationId, applied);
        remaining -= applied;
      }
    }
  }
}

function createGroupSettlement(
  fixture: ScaleGroupFixture,
  groupId: string,
  sender: string,
  recipient: string,
  maxAmount: number,
  forceConfirmed: boolean,
  next: () => number,
  counters: GroupBuildState,
  outstanding: Map<string, ObligationQueueEntry[]>,
  financialBase: number,
) {
  const available = availableObligationTotal(outstanding, sender, recipient);
  if (available <= 0) return false;
  const amount = forceConfirmed ? available : Math.min(available, maxAmount);
  if (amount <= 0) return false;
  const confirmed = forceConfirmed || next() < 0.8;
  const settlementCreatedAt = new Date(financialBase + counters.settlement * 600_000);
  const settlementId = fixtureId("settlement", counters.settlement);
  counters.settlement += 1;
  fixture.groupSettlements.push({
    id: settlementId, groupId, senderParticipantId: sender, recipientParticipantId: recipient,
    amount, paymentMethod: ["cash", "bank transfer", "e-wallet", "qris"][counters.settlement % 4]!,
    state: confirmed ? "confirmed" : "pending",
    paidOn: confirmed ? new Date(settlementCreatedAt.getTime()).toISOString().slice(0, 10) : null,
    createdAt: copyDate(settlementCreatedAt),
    confirmedAt: confirmed ? new Date(settlementCreatedAt.getTime() + 300_000) : null,
  });
  if (confirmed) {
    let budget = amount;
    for (const entry of oldestAvailableObligations(outstanding, sender, recipient)) {
      if (budget <= 0) break;
      const applied = Math.min(entry.remaining, budget);
      fixture.groupSettlementApplications.push({
        id: fixtureId("settlementApp", counters.settlementApp), groupId, settlementId,
        obligationId: entry.obligationId, appliedAmount: applied, createdAt: copyDate(settlementCreatedAt),
      });
      counters.settlementApp += 1;
      reserveObligation(outstanding, entry.obligationId, applied);
      budget -= applied;
    }
  }
  if (confirmed && counters.settlement % 17 === 0) {
    const content = receiptContent();
    fixture.groupSettlementProofs.push({
      id: fixtureId("settlementProof", counters.proof), groupId, settlementId,
      originalFilename: `settlement-proof-${String(counters.proof + 1).padStart(3, "0")}.png`,
      mediaType: "image/png", byteSize: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      content, createdAt: copyDate(settlementCreatedAt),
    });
    counters.proof += 1;
  }
  return true;
}

function appendGroupSettlements(
  fixture: ScaleGroupFixture,
  groupId: string,
  plan: GroupPlan,
  next: () => number,
  counters: GroupBuildState,
  registeredSet: Set<string>,
  outstanding: Map<string, ObligationQueueEntry[]>,
  financialBase: number,
) {
  const pairTotals = [...outstanding.entries()]
    .map(([key, queue]) => ({ key, total: queue.reduce((sum, row) => sum + row.remaining, 0) }))
    .filter((row) => {
      const [sender, recipient] = row.key.split("|") as [string, string];
      return row.total > 0 && registeredSet.has(sender) && registeredSet.has(recipient);
    })
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  let quota = plan.settlementQuota;
  const settle = (sender: string, recipient: string, maxAmount: number, forceConfirmed: boolean) => {
    if (quota <= 0) return;
    if (availableObligationTotal(outstanding, sender, recipient) <= 0) return;
    if (createGroupSettlement(fixture, groupId, sender, recipient, maxAmount, forceConfirmed, next, counters, outstanding, financialBase)) {
      quota -= 1;
    }
  };
  if (plan.settleAll) {
    for (const { key } of pairTotals) {
      const [sender, recipient] = key.split("|") as [string, string];
      settle(sender, recipient, Number.MAX_SAFE_INTEGER, true);
    }
    return;
  }
  for (const { key, total } of pairTotals) {
    const [sender, recipient] = key.split("|") as [string, string];
    while (quota > 0 && availableObligationTotal(outstanding, sender, recipient) > 0) {
      settle(sender, recipient, Math.min(total, 40_000 + integer(next, 160_000)), false);
      if (next() < 0.35) break;
    }
    if (quota <= 0) break;
  }
}

function appendGroupJoinRequests(
  fixture: ScaleGroupFixture,
  ownerUserId: string,
  secondaryUsers: FixtureSecondaryUser[],
) {
  const quietGroup = fixture.groups[7]!;
  const quietParticipants = fixture.groupParticipants.filter((row) => row.groupId === quietGroup.id);
  const quietExternal = quietParticipants.find((row) => row.userId === null)!;
  const quietRequester = quietParticipants.find((row) => row.userId !== null)!.userId!;
  const joinBase = new Date(Date.UTC(2026, 7, 10, 9));
  const pushJoinRequest = (
    groupId: string, kind: FixtureGroupJoinRequest["kind"], targetUserId: string, requesterUserId: string,
    status: FixtureGroupJoinRequest["status"], participantId: string | null, displayName: string | null, label: string | null,
    index: number,
  ) => {
    const expiresAt = new Date(joinBase.getTime() + 14 * 86_400_000);
    const createdAt = status === "expired" ? new Date(joinBase.getTime() - 30 * 86_400_000) : copyDate(joinBase);
    fixture.groupJoinRequests.push({
      id: fixtureId("groupJoinRequest", index), groupId, kind, participantId,
      participantDisplayNameSnapshot: displayName, participantLabelSnapshot: label,
      targetUserId, requesterUserId, status,
      expiresAt: status === "expired" ? new Date(joinBase.getTime() - 16 * 86_400_000) : expiresAt,
      createdAt, updatedAt: copyDate(joinBase),
      acceptedAt: status === "accepted" ? new Date(joinBase.getTime() + 86_400_000) : null,
      declinedAt: status === "declined" ? new Date(joinBase.getTime() + 86_400_000) : null,
      revokedAt: status === "revoked" ? new Date(joinBase.getTime() + 86_400_000) : null,
      expiredAt: status === "expired" ? new Date(joinBase.getTime() - 16 * 86_400_000) : null,
    });
  };
  pushJoinRequest(quietGroup.id, "member_invitation", ownerUserId, quietRequester, "pending", null, null, null, 0);
  pushJoinRequest(quietGroup.id, "participant_link", secondaryUsers[24]!.id, quietRequester, "pending", quietExternal.id, quietExternal.displayName, quietExternal.label, 1);
  pushJoinRequest(fixture.groups[0]!.id, "member_invitation", secondaryUsers[19]!.id, ownerUserId, "accepted", null, null, null, 2);
  pushJoinRequest(fixture.groups[3]!.id, "member_invitation", secondaryUsers[21]!.id, ownerUserId, "declined", null, null, null, 3);
  pushJoinRequest(fixture.groups[4]!.id, "participant_link", secondaryUsers[22]!.id, ownerUserId, "revoked", fixture.groupParticipants.find((row) => row.groupId === fixture.groups[4]!.id && row.userId === null)?.id ?? null, "Teman Desain", null, 4);
  pushJoinRequest(fixture.groups[5]!.id, "member_invitation", secondaryUsers[23]!.id, ownerUserId, "expired", null, null, null, 5);
}

const BUDGET_ACTIVE_PLAN_NAMES = ["Uncategorized", "Makanan", "Transportasi", "Belanja", "Hiburan", "Kesehatan", "Tagihan", "Tabungan", "Donasi", "Keluarga"];

const BUDGET_ACTIVE_BASE_ALLOCATIONS: Record<string, number> = {
  Uncategorized: 1_800_000, Makanan: 3_000_000, Transportasi: 2_000_000, Belanja: 2_500_000,
  Hiburan: 1_000_000, Kesehatan: 1_500_000, Tagihan: 2_000_000, Tabungan: 1_000_000,
  Donasi: 800_000, Keluarga: 1_200_000,
};

// The canonical active period (September 2026) is the manual UI-inspection
// scenario, so its manual activity is a small deterministic set of curated
// rows instead of a slice of the bulk stress traffic. Amounts are sized so
// the active period nets roughly Rp 10-15m against the Rp 20m total budget:
// Makanan slightly over plan, Transportasi nearly exhausted, several normal
// categories, Tabungan/Belanja with remaining budget, and one voided plus one
// inflow row for authority coverage. Bulk manual volume lives in historical
// periods (ordinals 1-19).
type ActiveManualRow = {
  direction: "outflow" | "inflow";
  amount: number;
  description: string;
  occurredOn: string;
  status: "posted" | "voided";
  category: string;
};

const ACTIVE_MANUAL_SCENARIO: ActiveManualRow[] = [
  { direction: "outflow", amount: 850_000, description: "Belanja mingguan pasar " + "x".repeat(217), occurredOn: "2026-09-02", status: "posted", category: "Makanan" },
  { direction: "outflow", amount: 380_000, description: "Bensin motor", occurredOn: "2026-09-03", status: "posted", category: "Transportasi" },
  { direction: "outflow", amount: 480_000, description: "Belanja bulanan", occurredOn: "2026-09-06", status: "posted", category: "Belanja" },
  { direction: "outflow", amount: 90_000, description: "Iuran RT", occurredOn: "2026-09-07", status: "posted", category: "Tagihan" },
  { direction: "outflow", amount: 620_000, description: "Makan siang kantor", occurredOn: "2026-09-09", status: "posted", category: "Makanan" },
  { direction: "outflow", amount: 500_000, description: "Catering dibatalkan", occurredOn: "2026-09-11", status: "voided", category: "Makanan" },
  { direction: "outflow", amount: 420_000, description: "Tol dan parkir", occurredOn: "2026-09-12", status: "posted", category: "Transportasi" },
  { direction: "outflow", amount: 60_000, description: "Obat", occurredOn: "2026-09-14", status: "posted", category: "Kesehatan" },
  { direction: "outflow", amount: 740_000, description: "Traktir keluarga", occurredOn: "2026-09-16", status: "posted", category: "Makanan" },
  { direction: "outflow", amount: 260_000, description: "Peralatan rumah", occurredOn: "2026-09-19", status: "posted", category: "Belanja" },
  { direction: "outflow", amount: 310_000, description: "Ojek dan MRT", occurredOn: "2026-09-21", status: "posted", category: "Transportasi" },
  { direction: "outflow", amount: 590_000, description: "Kopi dan jajan", occurredOn: "2026-09-23", status: "posted", category: "Makanan" },
  { direction: "inflow", amount: 150_000, description: "Refund belanja", occurredOn: "2026-09-24", status: "posted", category: "Belanja" },
];

// Linked Group imports are selective, mirroring a user who has not imported
// every Group expense/settlement into the Budget. Historical owner activity
// links in full; the active period links only a bounded subset so it stays
// realistic while keeping linked Personal/Group coverage.
const ACTIVE_LINKED_GROUP_EXPENSE_BUDGET = 300_000;
const ACTIVE_LINKED_SETTLEMENT_COUNT = 10;

// Safety-net calibration: after all deterministic sources are built, top up
// the active showcase categories toward their designed net levels. Curated
// rows are sized to land near these targets, so calibration normally adds
// little or nothing; it only fires when a source stream shifts underneath.
const ACTIVE_CATEGORY_NET_TARGETS: Record<string, number> = {
  Makanan: 3_450_000, Transportasi: 1_900_000, Belanja: 1_500_000, Tagihan: 2_050_000,
  Tabungan: 850_000,
};
const ACTIVE_CALIBRATION_DUST = 100_000;

// Deliberate historical hostility: one explicit overspend row in August 2026
// so edge/negative coverage does not depend on incidental random volume.
const HISTORICAL_STRESS_SCENARIO = {
  direction: "outflow" as const,
  amount: 6_000_000,
  description: "Stress: belanja elektronik Agustus",
  occurredOn: "2026-08-15",
  category: "Hiburan",
  ordinal: 19,
};

type BudgetBuildState = {
  transaction: number;
  impact: number;
  occurrence: number;
  classified: number;
};

type BudgetBuildContext = {
  fixture: ScaleBudgetFixture;
  ownerUserId: string;
  next: () => number;
  fixedCreatedAt: Date;
  periodByOrdinal: Map<number, FixtureBudgetPeriod>;
  activePeriod: FixtureBudgetPeriod;
  uncategorizedId: string;
  categoryByName: Map<string, FixtureBudgetCategory>;
  activePlanCategoryIds: string[];
  state: BudgetBuildState;
  classifiedObligations: Set<string>;
};

type BudgetTransactionInput = {
  direction: "outflow" | "inflow"; amount: number; description: string;
  occurredOn: string; status: "posted" | "voided"; origin: "manual" | "linked" | "recurring";
};

function pushBudgetImpact(
  ctx: BudgetBuildContext,
  transactionId: string,
  categoryId: string,
  periodId: string | null,
  amount: number,
  status: "applied" | "pending",
  targetPeriodOrdinal: number,
) {
  ctx.fixture.budgetImpacts.push({
    id: fixtureId("budgetImpact", ctx.state.impact), budgetTransactionId: transactionId,
    budgetCategoryId: categoryId, budgetPeriodId: periodId, amount, status,
    targetPeriodOrdinal, createdAt: copyDate(ctx.fixedCreatedAt), updatedAt: copyDate(ctx.fixedCreatedAt),
  });
  ctx.state.impact += 1;
}

function pushBudgetTransaction(ctx: BudgetBuildContext, input: BudgetTransactionInput) {
  const id = fixtureId("budgetTransaction", ctx.state.transaction);
  ctx.state.transaction += 1;
  ctx.fixture.budgetTransactions.push({
    id, direction: input.direction, amount: input.amount, description: input.description,
    occurredOn: input.occurredOn, status: input.status, origin: input.origin,
    createdAt: copyDate(ctx.fixedCreatedAt), updatedAt: copyDate(ctx.fixedCreatedAt),
    voidedAt: input.status === "voided" ? new Date(Date.UTC(2026, 4, 10, 9)) : null,
  });
  return id;
}

function randomBudgetDay(ctx: BudgetBuildContext, period: FixtureBudgetPeriod) {
  const days = Number(period.endsOn.slice(8, 10));
  return `${period.startsOn.slice(0, 8)}${String(1 + integer(ctx.next, days)).padStart(2, "0")}`;
}

function periodForBudgetDate(ctx: BudgetBuildContext, occurredOn: string) {
  return ctx.fixture.budgetPeriods.find((period) => occurredOn >= period.startsOn && occurredOn <= period.endsOn);
}

function buildBudgetPeriodsAndPlans(fixture: ScaleBudgetFixture, fixedCreatedAt: Date) {
  const periodByOrdinal = new Map<number, FixtureBudgetPeriod>();
  const categoryByName = new Map<string, FixtureBudgetCategory>();
  for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
    const range = budgetPeriodRange(ordinal);
    fixture.budgetPeriods.push({
      id: fixtureId("budgetPeriod", ordinal - 1),
      name: range.name, ordinal,
      startsOn: range.startsOn, endsOn: range.endsOn,
      totalBudget: ordinal === 20 ? 20_000_000 : 8_000_000 + ((ordinal * 1_234_567) % 12_000_000),
      status: ordinal === 20 ? "active" : "closed",
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    periodByOrdinal.set(ordinal, fixture.budgetPeriods[ordinal - 1]!);
  }
  const activePeriod = periodByOrdinal.get(20)!;
  SCALE_BUDGET_CATEGORY_NAMES.forEach((name, categoryIndex) => {
    fixture.budgetCategories.push({
      id: fixtureId("budgetCategory", categoryIndex),
      name, normalizedName: name.toLowerCase(), systemKey: categoryIndex === 0 ? "uncategorized" : null,
      archivedAt: name === "Gadget Lama" ? new Date(Date.UTC(2025, 5, 10, 9)) : null,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    categoryByName.set(name, fixture.budgetCategories[categoryIndex]!);
  });
  const uncategorizedId = categoryByName.get("Uncategorized")!.id;
  fixture.budgetPeriods.forEach((period) => {
    const names = period.ordinal === 20
      ? [...BUDGET_ACTIVE_PLAN_NAMES]
      : ["Uncategorized", ...SCALE_BUDGET_CATEGORY_NAMES.slice(1, 14).filter((_, index) => (period.ordinal * 7 + index * 3) % 10 < 7).slice(0, 8)];
    if (period.ordinal <= 5 && !names.includes("Gadget Lama")) names.push("Gadget Lama");
    names.forEach((name, displayOrder) => {
      const base = BUDGET_ACTIVE_BASE_ALLOCATIONS[name] ?? 400_000 + (((period.ordinal * 31 + displayOrder * 17) % 20) * 100_000);
      const allocatedAmount = period.ordinal === 20 ? base : Math.floor(base * (70 + ((period.ordinal * 13 + displayOrder * 7) % 60)) / 100);
      fixture.budgetPeriodCategories.push({
        budgetPeriodId: period.id, budgetCategoryId: categoryByName.get(name)!.id,
        allocatedAmount, displayOrder,
      });
    });
  });
  const activePlanCategoryIds = fixture.budgetPeriodCategories.filter((row) => row.budgetPeriodId === activePeriod.id).map((row) => row.budgetCategoryId);
  return { periodByOrdinal, activePeriod, uncategorizedId, categoryByName, activePlanCategoryIds };
}

function buildManualBudgetTransactions(ctx: BudgetBuildContext) {
  for (const row of ACTIVE_MANUAL_SCENARIO) {
    const categoryId = ctx.categoryByName.get(row.category)!.id;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: row.direction, amount: row.amount, description: row.description,
      occurredOn: row.occurredOn, status: row.status, origin: "manual",
    });
    pushBudgetImpact(ctx, transactionId, categoryId, ctx.activePeriod.id, row.amount, "applied", ctx.activePeriod.ordinal);
  }
  {
    const categoryId = ctx.categoryByName.get(HISTORICAL_STRESS_SCENARIO.category)!.id;
    const period = ctx.periodByOrdinal.get(HISTORICAL_STRESS_SCENARIO.ordinal)!;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: HISTORICAL_STRESS_SCENARIO.direction, amount: HISTORICAL_STRESS_SCENARIO.amount,
      description: HISTORICAL_STRESS_SCENARIO.description, occurredOn: HISTORICAL_STRESS_SCENARIO.occurredOn,
      status: "posted", origin: "manual",
    });
    pushBudgetImpact(ctx, transactionId, categoryId, period.id, HISTORICAL_STRESS_SCENARIO.amount, "applied", period.ordinal);
  }
  const bulkCount = 2140 - ACTIVE_MANUAL_SCENARIO.length - 1;
  for (let index = 0; index < bulkCount; index += 1) {
    const period = ctx.periodByOrdinal.get(1 + integer(ctx.next, 19))!;
    const occurredOn = randomBudgetDay(ctx, period);
    const direction = ctx.next() < 0.15 ? "inflow" : "outflow";
    const amount = index % 40 === 11
      ? 2_000_000 + integer(ctx.next, 6_000_000)
      : index % 33 === 7
        ? 5_000 + integer(ctx.next, 15_000)
        : 20_000 + integer(ctx.next, 980_000);
    const title = SCALE_BUDGET_DESCRIPTIONS[(index * 7) % SCALE_BUDGET_DESCRIPTIONS.length]!;
    const description = `${title}${index >= SCALE_BUDGET_DESCRIPTIONS.length ? ` #${Math.floor(index / SCALE_BUDGET_DESCRIPTIONS.length) + 1}` : ""}`;
    const status = ctx.next() < 0.04 ? "voided" : "posted";
    const transactionId = pushBudgetTransaction(ctx, { direction, amount, description, occurredOn, status, origin: "manual" });
    const categoryId = ctx.fixture.budgetCategories[integer(ctx.next, ctx.fixture.budgetCategories.length)]!.id;
    pushBudgetImpact(ctx, transactionId, categoryId, period.id, amount, "applied", period.ordinal);
  }
}

function buildSpreadBudgetTransactions(ctx: BudgetBuildContext) {
  for (let index = 0; index < 36; index += 1) {
    const historical = index < 32;
    const originOrdinal = historical ? 14 + (index % 6) : 20;
    const maxCount = historical ? 21 - originOrdinal : 6;
    const count = Math.max(2, Math.min(2 + (index % 5), maxCount));
    const amount = 120_000 + integer(ctx.next, 780_000);
    const origin = ctx.periodByOrdinal.get(originOrdinal)!;
    const occurredOn = randomBudgetDay(ctx, origin);
    const categoryId = ctx.activePlanCategoryIds[index % ctx.activePlanCategoryIds.length]!;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: "outflow", amount, description: `Spread plan #${index + 1}`,
      occurredOn, status: "posted", origin: "manual",
    });
    splitBudgetAmount(amount, count).forEach((slice, sliceIndex) => {
      const targetOrdinal = originOrdinal + sliceIndex;
      const applied = historical || sliceIndex === 0;
      pushBudgetImpact(
        ctx, transactionId, categoryId,
        applied ? ctx.periodByOrdinal.get(targetOrdinal)!.id : null,
        slice, applied ? "applied" : "pending", targetOrdinal,
      );
    });
  }
}

function buildPersonalBudgetLinks(
  ctx: BudgetBuildContext,
  outings: FixtureOuting[],
  expenses: FixtureExpense[],
  repayments: FixtureRepayment[],
) {
  const outingById = new Map(outings.map((outing) => [outing.id, outing]));
  expenses.forEach((expense, expenseIndex) => {
    if ((expenseIndex * 7 + 3) % 13 >= 3) return;
    const outing = outingById.get(expense.outingId)!;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: "outflow", amount: expense.amount, description: expense.description,
      occurredOn: outing.occurredOn, status: "posted", origin: "linked",
    });
    ctx.fixture.budgetPersonalExpenseSources.push({ budgetTransactionId: transactionId, expenseId: expense.id });
    const period = periodForBudgetDate(ctx, outing.occurredOn);
    if (period) pushBudgetImpact(ctx, transactionId, ctx.uncategorizedId, period.id, expense.amount, "applied", period.ordinal);
  });
  repayments.forEach((repayment, repaymentIndex) => {
    if ((repaymentIndex * 5 + 1) % 17 >= 2) return;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: "inflow", amount: repayment.amount, description: `Personal repayment #${repaymentIndex + 1}`,
      occurredOn: repayment.paidOn, status: "posted", origin: "linked",
    });
    ctx.fixture.budgetPersonalRepaymentSources.push({ budgetTransactionId: transactionId, repaymentId: repayment.id });
    const period = periodForBudgetDate(ctx, repayment.paidOn);
    if (period) pushBudgetImpact(ctx, transactionId, ctx.uncategorizedId, period.id, repayment.amount, "applied", period.ordinal);
  });
}

function buildGroupBudgetLinks(ctx: BudgetBuildContext, groups: ScaleGroupFixture) {
  const participantById = new Map(groups.groupParticipants.map((participant) => [participant.id, participant]));
  const ownerPayerExpenses = groups.groupExpenses.filter((expense) => {
    const payer = participantById.get(expense.payerParticipantId);
    return expense.state === "confirmed" && payer?.userId === ctx.ownerUserId;
  });
  const historicalOwnerExpenses = ownerPayerExpenses.filter((expense) => expense.occurredOn < "2026-09-01");
  const activeCandidates = ownerPayerExpenses
    .filter((expense) => expense.occurredOn >= "2026-09-01" && expense.occurredOn <= "2026-09-30")
    .sort((left, right) => left.totalAmount - right.totalAmount || (left.id < right.id ? -1 : 1));
  const activeOwnerExpenses: typeof activeCandidates = [];
  let activeBudget = 0;
  for (const expense of activeCandidates) {
    if (activeBudget + expense.totalAmount > ACTIVE_LINKED_GROUP_EXPENSE_BUDGET) continue;
    activeOwnerExpenses.push(expense);
    activeBudget += expense.totalAmount;
  }
  [...historicalOwnerExpenses, ...activeOwnerExpenses].forEach((expense) => {
    const transactionId = pushBudgetTransaction(ctx, {
      direction: "outflow", amount: expense.totalAmount, description: `Group: ${expense.description}`.slice(0, 240),
      occurredOn: expense.occurredOn, status: "posted", origin: "linked",
    });
    ctx.fixture.budgetGroupExpenseSources.push({ budgetTransactionId: transactionId, groupExpenseId: expense.id });
    const period = periodForBudgetDate(ctx, expense.occurredOn);
    if (period && expense.occurredOn) pushBudgetImpact(ctx, transactionId, ctx.uncategorizedId, period.id, expense.totalAmount, "applied", period.ordinal);
  });
  const ownerSettlements = groups.groupSettlements.filter((settlement) => {
    if (settlement.state !== "confirmed" || !settlement.paidOn) return false;
    const sender = participantById.get(settlement.senderParticipantId);
    const recipient = participantById.get(settlement.recipientParticipantId);
    return sender?.userId === ctx.ownerUserId || recipient?.userId === ctx.ownerUserId;
  });
  ownerSettlements.slice(0, ACTIVE_LINKED_SETTLEMENT_COUNT).forEach((settlement) => {
    const sender = participantById.get(settlement.senderParticipantId)!;
    const isSender = sender.userId === ctx.ownerUserId;
    const transactionId = pushBudgetTransaction(ctx, {
      direction: isSender ? "outflow" : "inflow", amount: settlement.amount,
      description: `Group settlement #${settlement.id.slice(-6)}`.slice(0, 240),
      occurredOn: settlement.paidOn!, status: "posted", origin: "linked",
    });
    ctx.fixture.budgetGroupSettlementSources.push({ budgetTransactionId: transactionId, groupSettlementId: settlement.id });
    const period = periodForBudgetDate(ctx, settlement.paidOn!);
    if (!period) return;
    if (isSender && ctx.state.classified < 40) {
      const obligation = groups.groupSettlementApplications
        .filter((application) => application.settlementId === settlement.id)
        .map((application) => groups.groupObligations.find((row) => row.id === application.obligationId)!)
        .find((obligation) => obligation && participantById.get(obligation.debtorParticipantId)?.userId === ctx.ownerUserId);
      if (obligation && !ctx.classifiedObligations.has(obligation.id)) {
        const categoryId = ctx.activePlanCategoryIds[ctx.state.classified % ctx.activePlanCategoryIds.length]!;
        ctx.fixture.budgetGroupObligationClassifications.push({ groupObligationId: obligation.id, budgetCategoryId: categoryId });
        pushBudgetImpact(ctx, transactionId, categoryId, period.id, settlement.amount, "applied", period.ordinal);
        ctx.classifiedObligations.add(obligation.id);
        ctx.state.classified += 1;
        return;
      }
    }
    pushBudgetImpact(ctx, transactionId, ctx.uncategorizedId, period.id, settlement.amount, "applied", period.ordinal);
  });
}

function buildRecurringTemplates(ctx: BudgetBuildContext) {
  const usableCategoryIds = ctx.fixture.budgetCategories.filter((category) => category.archivedAt === null).map((category) => category.id);
  for (let index = 0; index < 75; index += 1) {
    const startsOn = index === 0
      ? "2025-01-31"
      : index === 1
        ? "2025-04-30"
        : index === 2
          ? "2024-02-29"
          : `2025-${String(1 + ((index * 37) % 12)).padStart(2, "0")}-${String(1 + ((index * 13) % 28)).padStart(2, "0")}`;
    ctx.fixture.recurringTemplates.push({
      id: fixtureId("recurringTemplate", index),
      name: index === 4 ? SCALE_HEAVY_RECURRING_NAME : `${SCALE_RECURRING_NAMES[index % SCALE_RECURRING_NAMES.length]}${index >= SCALE_RECURRING_NAMES.length ? ` ${Math.floor(index / SCALE_RECURRING_NAMES.length) + 1}` : ""}`,
      amount: index === 4 ? 1_200_000 : 30_000 + integer(ctx.next, 470_000),
      categoryId: usableCategoryIds[index % usableCategoryIds.length]!,
      frequency: index % 5 < 3 ? "monthly" : "every_budget_period",
      startsOn,
      spreadCount: index % 6 === 5 ? 2 + (index % 3) : 1,
      archivedAt: index >= 60 ? new Date(Date.UTC(2026, 4, 15, 9)) : null,
      createdAt: copyDate(ctx.fixedCreatedAt), updatedAt: copyDate(ctx.fixedCreatedAt),
    });
  }
}

function recordRecurringPayment(
  ctx: BudgetBuildContext,
  template: FixtureBudgetRecurringTemplate,
  period: FixtureBudgetPeriod,
  scheduledOn: string,
  categoryId: string,
) {
  const transactionId = pushBudgetTransaction(ctx, {
    direction: "outflow", amount: template.amount, description: `Recurring: ${template.name}`.slice(0, 240),
    occurredOn: scheduledOn, status: "posted", origin: "recurring",
  });
  splitBudgetAmount(template.amount, template.spreadCount).forEach((slice, sliceIndex) => {
    const targetOrdinal = period.ordinal + sliceIndex;
    const targetPeriod = ctx.periodByOrdinal.get(targetOrdinal);
    const applied = targetPeriod !== undefined;
    pushBudgetImpact(
      ctx, transactionId, categoryId,
      applied ? targetPeriod!.id : null,
      slice, applied ? "applied" : "pending", targetOrdinal,
    );
  });
  return transactionId;
}

function buildRecurringOccurrences(ctx: BudgetBuildContext) {
  const activePlanSet = new Set(ctx.activePlanCategoryIds);
  for (const template of ctx.fixture.recurringTemplates) {
    const archived = template.archivedAt !== null;
    for (let ordinal = 15; ordinal <= 20; ordinal += 1) {
      if (archived && ordinal > 16) continue;
      const period = ctx.periodByOrdinal.get(ordinal)!;
      if (template.startsOn > period.endsOn) continue;
      const scheduledOn = scheduledRecurringDate(template, period);
      const roll = ctx.next();
      let status: "due" | "recorded" | "skipped";
      if (ordinal === 20) {
        if (!activePlanSet.has(template.categoryId)) {
          status = roll < 0.5 ? "due" : "skipped";
        } else {
          status = roll < 0.5 ? "due" : roll < 0.65 ? "recorded" : "skipped";
        }
      } else {
        const wouldReachActive = ordinal + template.spreadCount - 1 >= 20;
        if (wouldReachActive && !activePlanSet.has(template.categoryId)) {
          status = "skipped";
        } else {
          status = roll < 0.62 ? "recorded" : "skipped";
        }
      }
      const budgetTransactionId = status === "recorded"
        ? recordRecurringPayment(ctx, template, period, scheduledOn, template.categoryId)
        : null;
      ctx.fixture.recurringOccurrences.push({
        id: fixtureId("occurrence", ctx.state.occurrence),
        recurringTemplateId: template.id, scheduledPeriodId: period.id, scheduledOn,
        amount: template.amount, categoryId: template.categoryId, spreadCount: template.spreadCount,
        status, budgetTransactionId, createdAt: copyDate(ctx.fixedCreatedAt), updatedAt: copyDate(ctx.fixedCreatedAt),
      });
      ctx.state.occurrence += 1;
    }
  }
}

function scheduledRecurringDate(template: FixtureBudgetRecurringTemplate, period: FixtureBudgetPeriod) {
  if (template.frequency === "every_budget_period") {
    return template.startsOn >= period.startsOn && template.startsOn <= period.endsOn ? template.startsOn : period.startsOn;
  }
  const anchor = Number(template.startsOn.slice(8, 10));
  const days = Number(period.endsOn.slice(8, 10));
  return `${period.startsOn.slice(0, 8)}${String(Math.min(anchor, days)).padStart(2, "0")}`;
}

function applyBudgetTopUps(ctx: BudgetBuildContext) {
  const appliedByCategory = new Map<string, number>();
  for (const impact of ctx.fixture.budgetImpacts) {
    if (impact.status !== "applied" || impact.budgetPeriodId !== ctx.activePeriod.id) continue;
    const transaction = ctx.fixture.budgetTransactions.find((row) => row.id === impact.budgetTransactionId)!;
    if (transaction.status !== "posted") continue;
    appliedByCategory.set(impact.budgetCategoryId, (appliedByCategory.get(impact.budgetCategoryId) ?? 0) + (transaction.direction === "outflow" ? impact.amount : -impact.amount));
  }
  for (const [categoryName, targetNet] of Object.entries(ACTIVE_CATEGORY_NET_TARGETS)) {
    const categoryId = ctx.categoryByName.get(categoryName)!.id;
    const current = appliedByCategory.get(categoryId) ?? 0;
    if (current >= targetNet - ACTIVE_CALIBRATION_DUST) continue;
    topUpBudgetCategory(ctx, appliedByCategory, categoryName, targetNet);
  }
}

function topUpBudgetCategory(ctx: BudgetBuildContext, appliedByCategory: Map<string, number>, categoryName: string, targetNet: number) {
  const categoryId = ctx.categoryByName.get(categoryName)!.id;
  const current = appliedByCategory.get(categoryId) ?? 0;
  if (current >= targetNet) return;
  const transactionId = pushBudgetTransaction(ctx, {
    direction: "outflow", amount: targetNet - current, description: `Top-up ${categoryName}`,
    occurredOn: ctx.activePeriod.startsOn, status: "posted", origin: "manual",
  });
  pushBudgetImpact(ctx, transactionId, categoryId, ctx.activePeriod.id, targetNet - current, "applied", ctx.activePeriod.ordinal);
}

function generateGroups(ownerUserId: string, fixedCreatedAt: Date, secondaryUsers: FixtureSecondaryUser[], seed: number): ScaleGroupFixture {
  const next = randomUniform(seed ^ 0x61001);
  const fixture: ScaleGroupFixture = {
    groups: [], groupParticipants: [], groupMemberships: [], groupExpenses: [],
    groupExpenseShares: [], groupObligations: [], groupSettlements: [],
    groupSettlementApplications: [], groupOffsets: [], groupOffsetApplications: [],
    groupExpenseReceipts: [], groupSettlementProofs: [], groupExpenseLifecycleEvents: [],
    groupJoinRequests: [],
  };
  const plans = groupPlans();
  const counters: GroupBuildState = {
    userCursor: 0, expense: 0, share: 0, obligation: 0, settlement: 0,
    settlementApp: 0, offset: 0, offsetApp: 0, receipt: 0, proof: 0, lifecycle: 0,
  };
  const groupBaseDate = Date.UTC(2024, 5, 1);
  const financialBase = Date.UTC(2026, 8, 29);

  plans.forEach((plan, groupIndex) => {
    const identities = assignGroupIdentities(fixture, plan, groupIndex, ownerUserId, secondaryUsers, fixedCreatedAt, counters);
    const pool = groupDescriptionPool(plan.name);
    for (let expenseIndex = 0; expenseIndex < plan.expenses; expenseIndex += 1) {
      appendGroupExpense(fixture, identities.groupId, plan, groupIndex, expenseIndex, identities, pool, next, counters, groupBaseDate);
    }
    const outstanding = buildOutstandingMap(fixture, identities.groupId);
    const registeredSet = new Set(identities.registeredParticipantIds);
    appendGroupOffsets(fixture, identities.groupId, plan, next, counters, registeredSet, outstanding, financialBase);
    appendGroupSettlements(fixture, identities.groupId, plan, next, counters, registeredSet, outstanding, financialBase);
  });
  appendGroupJoinRequests(fixture, ownerUserId, secondaryUsers);
  return fixture;
}

export type FixtureOrganization = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureOrganizationScope = {
  id: string;
  organizationId: string;
};

export type FixtureOrganizationParticipant = {
  id: string;
  organizationId: string;
  userId: string | null;
  displayName: string | null;
  label: string | null;
  sourcePersonalFriendId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureOrganizationMembership = {
  organizationId: string;
  userId: string;
  participantId: string;
  role: "owner" | "admin" | "treasurer" | "member" | "custom";
  customCapabilities: string[];
  joinedAt: Date;
};

export type FixtureOrganizationInvitation = {
  id: string;
  organizationId: string;
  targetUserId: string;
  participantId: string | null;
  invitedByUserId: string;
  role: "admin" | "treasurer" | "member";
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  expiredAt: Date | null;
};

export type ScaleOrganizationFixture = {
  organizations: FixtureOrganization[];
  organizationScopes: FixtureOrganizationScope[];
  organizationParticipants: FixtureOrganizationParticipant[];
  organizationMemberships: FixtureOrganizationMembership[];
  organizationInvitations: FixtureOrganizationInvitation[];
  organizationFriends: FixtureFriend[];
  organizationOutings: FixtureOuting[];
  organizationExpenses: FixtureExpense[];
  organizationExpenseShares: FixtureExpenseShare[];
  organizationRepayments: FixtureRepayment[];
  organizationRepaymentAllocations: FixtureRepaymentAllocation[];
  organizationReceipts: FixtureReceipt[];
};

export const SCALE_ORGANIZATION_ANCHORS = [
  "Atelier Nusantara",
  "Engineering Guild",
  "Fasilkom Alumni",
  "Treasury Collective",
  "River Community",
  "Archived Syndicate",
  "Quiet Collective",
] as const;

type OrganizationPlan = {
  name: string;
  participants: number;
  localShare: number;
  ownerRole: "owner" | "admin" | "treasurer" | "member" | null;
  archived: boolean;
  friends: number;
  outings: number;
  expenses: number;
  repayments: number;
};

function organizationPlans(): OrganizationPlan[] {
  return [
    { name: "Atelier Nusantara", participants: 8, localShare: 2, ownerRole: "owner", archived: false, friends: 8, outings: 6, expenses: 16, repayments: 8 },
    { name: "Engineering Guild", participants: 48, localShare: 10, ownerRole: "owner", archived: false, friends: 24, outings: 18, expenses: 60, repayments: 28 },
    { name: "Fasilkom Alumni", participants: 24, localShare: 6, ownerRole: "admin", archived: false, friends: 14, outings: 10, expenses: 30, repayments: 14 },
    { name: "Treasury Collective", participants: 16, localShare: 3, ownerRole: "treasurer", archived: false, friends: 10, outings: 8, expenses: 22, repayments: 10 },
    { name: "River Community", participants: 20, localShare: 5, ownerRole: "member", archived: false, friends: 12, outings: 9, expenses: 26, repayments: 12 },
    { name: "Archived Syndicate", participants: 12, localShare: 3, ownerRole: "owner", archived: true, friends: 9, outings: 7, expenses: 18, repayments: 8 },
    { name: "Quiet Collective", participants: 4, localShare: 1, ownerRole: null, archived: false, friends: 3, outings: 2, expenses: 4, repayments: 2 },
    { name: "Scale org 008", participants: 14, localShare: 3, ownerRole: "owner", archived: false, friends: 10, outings: 8, expenses: 20, repayments: 10 },
    { name: "Scale org 009", participants: 16, localShare: 4, ownerRole: "owner", archived: false, friends: 11, outings: 9, expenses: 22, repayments: 12 },
    { name: "Scale org 010", participants: 16, localShare: 4, ownerRole: "owner", archived: false, friends: 11, outings: 9, expenses: 22, repayments: 14 },
  ];
}

export function organizationLedgerSizes() {
  return organizationPlans().map((plan) => ({
    friends: plan.friends,
    outings: plan.outings,
    expenses: plan.expenses,
    repayments: plan.repayments,
  }));
}

type OrganizationBuildState = {
  userCursor: number;
  friend: number;
  outing: number;
  expense: number;
  share: number;
  repayment: number;
};

function assignOrganizationIdentities(
  fixture: ScaleOrganizationFixture,
  plan: OrganizationPlan,
  orgIndex: number,
  ownerUserId: string,
  secondaryUsers: FixtureSecondaryUser[],
  personalFriends: FixtureFriend[],
  fixedCreatedAt: Date,
  state: OrganizationBuildState,
) {
  const orgId = fixtureId("org", orgIndex);
  fixture.organizations.push({
    id: orgId,
    name: plan.name,
    description: orgIndex < SCALE_ORGANIZATION_ANCHORS.length ? `Fixture ${plan.name} for manual UI inspection.` : `Deterministic background organization ${orgIndex + 1}.`,
    archivedAt: plan.archived ? new Date(Date.UTC(2026, 1, 20, 9)) : null,
    createdAt: copyDate(fixedCreatedAt),
    updatedAt: copyDate(fixedCreatedAt),
  });
  const scopeId = fixtureId("org", 100 + orgIndex);
  fixture.organizationScopes.push({ id: scopeId, organizationId: orgId });
  const registeredUserIds: string[] = [];
  if (plan.ownerRole) registeredUserIds.push(ownerUserId);
  const registeredTarget = Math.min(plan.participants - plan.localShare, secondaryUsers.length + (plan.ownerRole ? 1 : 0));
  let guard = 0;
  while (registeredUserIds.length < registeredTarget && guard < secondaryUsers.length * 2) {
    const candidate = secondaryUsers[state.userCursor % secondaryUsers.length]!.id;
    state.userCursor += 1;
    guard += 1;
    if (!registeredUserIds.includes(candidate)) registeredUserIds.push(candidate);
  }
  const localCount = plan.participants - registeredUserIds.length;
  const orgOwnerUserId = plan.ownerRole === "owner"
    ? ownerUserId
    : secondaryUsers[(orgIndex * 3 + 1) % secondaryUsers.length]!.id;
  if (!registeredUserIds.includes(orgOwnerUserId)) registeredUserIds[registeredUserIds.length - 1] = orgOwnerUserId;
  const participantByUser = new Map<string, string>();
  registeredUserIds.forEach((userId) => {
    const participantId = fixtureId("orgParticipant", fixture.organizationParticipants.length);
    fixture.organizationParticipants.push({
      id: participantId, organizationId: orgId, userId, displayName: null, label: null,
      sourcePersonalFriendId: null, createdByUserId: orgOwnerUserId,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    participantByUser.set(userId, participantId);
  });
  for (let localIndex = 0; localIndex < localCount; localIndex += 1) {
    const participantId = fixtureId("orgParticipant", fixture.organizationParticipants.length);
    const nameIndex = (orgIndex * 7 + localIndex * 5) % SCALE_EXTERNAL_NAMES.length;
    fixture.organizationParticipants.push({
      id: participantId, organizationId: orgId, userId: null,
      displayName: SCALE_EXTERNAL_NAMES[nameIndex]!,
      label: SCALE_EXTERNAL_LABELS[(orgIndex + localIndex * 2) % SCALE_EXTERNAL_LABELS.length]!,
        sourcePersonalFriendId: localIndex === 0 ? personalFriends[(orgIndex * 11) % personalFriends.length]!.id : null,
      createdByUserId: orgOwnerUserId,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
  }
  registeredUserIds.forEach((userId, memberIndex) => {
    fixture.organizationMemberships.push({
      organizationId: orgId, userId, participantId: participantByUser.get(userId)!,
      role: organizationRoleFor(plan, orgOwnerUserId, ownerUserId, userId, memberIndex, registeredUserIds.length),
      customCapabilities: organizationCapabilitiesFor(userId, orgOwnerUserId, memberIndex, registeredUserIds.length),
      joinedAt: copyDate(fixedCreatedAt),
    });
  });
  return { orgId, scopeId };
}

function organizationRoleFor(
  plan: OrganizationPlan,
  orgOwnerUserId: string,
  ownerUserId: string,
  userId: string,
  memberIndex: number,
  memberCount: number,
): FixtureOrganizationMembership["role"] {
  if (userId === orgOwnerUserId) return "owner";
  if (plan.ownerRole !== null && userId === ownerUserId) return plan.ownerRole;
  if (memberIndex === 1) return "admin";
  if (memberIndex === 2) return "treasurer";
  if (memberIndex === memberCount - 1 && memberCount >= 8) return "custom";
  return "member";
}

function organizationCapabilitiesFor(userId: string, orgOwnerUserId: string, memberIndex: number, memberCount: number) {
  if (userId !== orgOwnerUserId && memberIndex === memberCount - 1 && memberCount >= 8) return ["ledger.view", "chat.view"];
  return [];
}

function appendOrganizationLedger(
  fixture: ScaleOrganizationFixture,
  plan: OrganizationPlan,
  orgIndex: number,
  ownerUserId: string,
  next: () => number,
  fixedCreatedAt: Date,
  state: OrganizationBuildState,
  orgBaseDate: number,
) {
  const scopeFriends: FixtureFriend[] = [];
  for (let friendIndex = 0; friendIndex < plan.friends; friendIndex += 1) {
    scopeFriends.push({
      id: fixtureId("orgFriend", state.friend), userId: ownerUserId, linkedUserId: null,
      name: friendIndex === 0 && orgIndex === 1 ? "Long organization contact " + "x".repeat(93) : `Org ${orgIndex + 1} contact ${String(friendIndex + 1).padStart(2, "0")}`,
      phoneNumber: null, notes: null,
      archivedAt: friendIndex % 10 === 9 ? new Date(Date.UTC(2025, 5, 10, 9)) : null,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    state.friend += 1;
  }
  fixture.organizationFriends.push(...scopeFriends);
  const scopeOutings: FixtureOuting[] = [];
  for (let outingIndex = 0; outingIndex < plan.outings; outingIndex += 1) {
    const occurredAt = new Date(orgBaseDate + ((outingIndex * 53 + orgIndex * 131) % 800) * 86_400_000 + integer(next, 86_400_000));
    scopeOutings.push({
      id: fixtureId("orgOuting", state.outing), userId: ownerUserId, tripId: null,
      title: `Org ${orgIndex + 1} outing ${String(outingIndex + 1).padStart(2, "0")}`,
      occurredAt, occurredOn: occurredAt.toISOString().slice(0, 10), notes: null,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    state.outing += 1;
  }
  fixture.organizationOutings.push(...scopeOutings);
  for (let expenseIndex = 0; expenseIndex < plan.expenses; expenseIndex += 1) {
    appendOrganizationExpense(fixture, orgIndex, expenseIndex, ownerUserId, next, fixedCreatedAt, state, scopeOutings, scopeFriends);
  }
  const scopeRepayments: FixtureRepayment[] = [];
  for (let repaymentIndex = 0; repaymentIndex < plan.repayments; repaymentIndex += 1) {
    const amount = 10_000 + integer(next, 90_000);
    const paidAt = new Date(orgBaseDate + ((repaymentIndex * 61 + orgIndex * 97) % 800) * 86_400_000);
    scopeRepayments.push({
      id: fixtureId("orgRepayment", state.repayment), userId: ownerUserId,
      friendId: scopeFriends[(repaymentIndex * 11) % scopeFriends.length]!.id,
      amount, paidAt, paidOn: paidAt.toISOString().slice(0, 10),
      paymentMethod: "bank transfer", notes: null, createdAt: copyDate(fixedCreatedAt),
    });
    state.repayment += 1;
  }
  fixture.organizationRepayments.push(...scopeRepayments);
}

function appendOrganizationExpense(
  fixture: ScaleOrganizationFixture,
  orgIndex: number,
  expenseIndex: number,
  ownerUserId: string,
  next: () => number,
  fixedCreatedAt: Date,
  state: OrganizationBuildState,
  scopeOutings: FixtureOuting[],
  scopeFriends: FixtureFriend[],
) {
  const amount = 25_000 + integer(next, 475_000);
  const expenseId = fixtureId("orgExpense", state.expense);
  state.expense += 1;
  const expense: FixtureExpense = {
    id: expenseId, userId: ownerUserId,
    outingId: scopeOutings[expenseIndex % scopeOutings.length]!.id,
    description: expenseIndex === 0 && orgIndex === 1 ? "Long organization expense " + "z".repeat(173) : `Org ${orgIndex + 1} expense ${String(expenseIndex + 1).padStart(3, "0")}`,
    amount, createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
  };
  fixture.organizationExpenses.push(expense);
  const shareCount = 1 + ((orgIndex * 17 + expenseIndex * 5) % 3);
  const weights = Array.from({ length: shareCount }, (_, offset) => 1 + ((expenseIndex + offset * 2 + orgIndex) % 4));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const totalOwed = Math.floor(amount * (40 + (expenseIndex % 5) * 10) / 100);
  let remaining = totalOwed;
  for (let offset = 0; offset < shareCount; offset += 1) {
    const amountOwed = offset === shareCount - 1 ? remaining : Math.max(1, Math.floor(totalOwed * weights[offset]! / weightTotal));
    remaining -= amountOwed;
    fixture.organizationExpenseShares.push({
      id: fixtureId("orgShare", state.share), userId: ownerUserId, expenseId,
      friendId: scopeFriends[(expenseIndex * 7 + offset * 13) % scopeFriends.length]!.id,
      amountOwed, createdAt: copyDate(fixedCreatedAt),
    });
    state.share += 1;
  }
}

function generateOrganizations(
  ownerUserId: string,
  fixedCreatedAt: Date,
  secondaryUsers: FixtureSecondaryUser[],
  personalFriends: FixtureFriend[],
  seed: number,
): ScaleOrganizationFixture {
  const next = randomUniform(seed ^ 0x61002);
  const fixture: ScaleOrganizationFixture = {
    organizations: [], organizationScopes: [], organizationParticipants: [],
    organizationMemberships: [], organizationInvitations: [],
    organizationFriends: [], organizationOutings: [], organizationExpenses: [],
    organizationExpenseShares: [], organizationRepayments: [],
    organizationRepaymentAllocations: [], organizationReceipts: [],
  };
  const plans = organizationPlans();
  const state: OrganizationBuildState = { userCursor: 3, friend: 0, outing: 0, expense: 0, share: 0, repayment: 0 };
  const orgBaseDate = Date.UTC(2024, 3, 1);

  plans.forEach((plan, orgIndex) => {
    assignOrganizationIdentities(fixture, plan, orgIndex, ownerUserId, secondaryUsers, personalFriends, fixedCreatedAt, state);
    appendOrganizationLedger(fixture, plan, orgIndex, ownerUserId, next, fixedCreatedAt, state, orgBaseDate);
  });
  // Repayment allocations across the organization ledger (cap-respecting greedy).
  {
    const remainingByShare = new Map(fixture.organizationExpenseShares.map((share) => [share.id, share.amountOwed]));
    const sharesByFriend = new Map<string, FixtureExpenseShare[]>();
    for (const share of fixture.organizationExpenseShares) {
      sharesByFriend.set(share.friendId, [...(sharesByFriend.get(share.friendId) ?? []), share]);
    }
    for (const [repaymentIndex, repayment] of fixture.organizationRepayments.entries()) {
      if (repaymentIndex % 3 === 0) continue;
      let budget = repayment.amount;
      for (const share of (sharesByFriend.get(repayment.friendId) ?? []).slice(0, 2)) {
        const remainingShare = remainingByShare.get(share.id) ?? 0;
        if (remainingShare <= 0 || budget <= 0) continue;
        const amount = Math.min(remainingShare, budget);
        fixture.organizationRepaymentAllocations.push({
          userId: repayment.userId, repaymentId: repayment.id, expenseShareId: share.id,
          amount, createdAt: copyDate(fixedCreatedAt),
        });
        remainingByShare.set(share.id, remainingShare - amount);
        budget -= amount;
      }
    }
    const receiptTargets = fixture.organizationExpenses.filter((_, index) => index % 19 === 0).slice(0, 12);
    receiptTargets.forEach((expense, index) => {
      const content = receiptContent();
      fixture.organizationReceipts.push({
        id: fixtureId("orgReceipt", index), userId: expense.userId, expenseId: expense.id,
        originalFilename: `org-receipt-${String(index + 1).padStart(2, "0")}.png`,
        mediaType: "image/png", byteSize: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        content, createdAt: copyDate(fixedCreatedAt),
      });
    });
  }

  // Organization invitations: pending targeting the owner in the non-member org,
  // plus a spread of lifecycle states elsewhere.
  const quietOrg = fixture.organizations[6]!;
  const inviteBase = new Date(Date.UTC(2026, 7, 12, 9));
  const pushInvitation = (
    organizationId: string, targetUserId: string, invitedByUserId: string,
    role: FixtureOrganizationInvitation["role"], status: FixtureOrganizationInvitation["status"],
    index: number,
  ) => {
    fixture.organizationInvitations.push({
      id: fixtureId("orgInvitation", index), organizationId, targetUserId, participantId: null,
      invitedByUserId, role, status,
      createdAt: status === "expired" ? new Date(inviteBase.getTime() - 30 * 86_400_000) : copyDate(inviteBase),
      expiresAt: status === "expired" ? new Date(inviteBase.getTime() - 16 * 86_400_000) : new Date(inviteBase.getTime() + 14 * 86_400_000),
      updatedAt: copyDate(inviteBase),
      acceptedAt: status === "accepted" ? new Date(inviteBase.getTime() + 86_400_000) : null,
      declinedAt: status === "declined" ? new Date(inviteBase.getTime() + 86_400_000) : null,
      revokedAt: status === "revoked" ? new Date(inviteBase.getTime() + 86_400_000) : null,
      expiredAt: status === "expired" ? new Date(inviteBase.getTime() - 16 * 86_400_000) : null,
    });
  };
  const quietOwner = fixture.organizationMemberships.find((row) => row.organizationId === quietOrg.id && row.role === "owner")!.userId;
  pushInvitation(quietOrg.id, ownerUserId, quietOwner, "member", "pending", 0);
  pushInvitation(fixture.organizations[0]!.id, secondaryUsers[30]!.id, ownerUserId, "member", "pending", 1);
  pushInvitation(fixture.organizations[1]!.id, secondaryUsers[31]!.id, ownerUserId, "treasurer", "pending", 2);
  pushInvitation(fixture.organizations[2]!.id, secondaryUsers[32]!.id, ownerUserId, "admin", "pending", 3);
  pushInvitation(fixture.organizations[3]!.id, secondaryUsers[33]!.id, ownerUserId, "member", "accepted", 4);
  pushInvitation(fixture.organizations[4]!.id, secondaryUsers[34]!.id, ownerUserId, "member", "declined", 5);
  pushInvitation(fixture.organizations[7]!.id, secondaryUsers[35]!.id, ownerUserId, "member", "revoked", 6);
  pushInvitation(fixture.organizations[8]!.id, secondaryUsers[29]!.id, ownerUserId, "member", "expired", 7);

  return fixture;
}

export type FixtureBudgetPeriod = {
  id: string;
  name: string;
  ordinal: number;
  startsOn: string;
  endsOn: string;
  totalBudget: number;
  status: "active" | "closed";
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureBudgetCategory = {
  id: string;
  name: string;
  normalizedName: string;
  systemKey: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureBudgetPeriodCategory = {
  budgetPeriodId: string;
  budgetCategoryId: string;
  allocatedAmount: number;
  displayOrder: number;
};

export type FixtureBudgetTransaction = {
  id: string;
  direction: "outflow" | "inflow";
  amount: number;
  description: string;
  occurredOn: string;
  status: "posted" | "voided";
  origin: "manual" | "linked" | "recurring";
  createdAt: Date;
  updatedAt: Date;
  voidedAt: Date | null;
};

export type FixtureBudgetImpact = {
  id: string;
  budgetTransactionId: string;
  budgetCategoryId: string;
  budgetPeriodId: string | null;
  amount: number;
  status: "applied" | "pending";
  targetPeriodOrdinal: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureBudgetRecurringTemplate = {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  frequency: "every_budget_period" | "monthly";
  startsOn: string;
  spreadCount: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureBudgetRecurringOccurrence = {
  id: string;
  recurringTemplateId: string;
  scheduledPeriodId: string;
  scheduledOn: string;
  amount: number;
  categoryId: string;
  spreadCount: number;
  status: "due" | "recorded" | "skipped";
  budgetTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureBudgetPersonalExpenseSource = { budgetTransactionId: string; expenseId: string };
export type FixtureBudgetPersonalRepaymentSource = { budgetTransactionId: string; repaymentId: string };
export type FixtureBudgetGroupExpenseSource = { budgetTransactionId: string; groupExpenseId: string };
export type FixtureBudgetGroupSettlementSource = { budgetTransactionId: string; groupSettlementId: string };
export type FixtureBudgetGroupObligationClassification = { groupObligationId: string; budgetCategoryId: string };

export type ScaleBudgetFixture = {
  budgetPeriods: FixtureBudgetPeriod[];
  budgetCategories: FixtureBudgetCategory[];
  budgetPeriodCategories: FixtureBudgetPeriodCategory[];
  budgetTransactions: FixtureBudgetTransaction[];
  budgetImpacts: FixtureBudgetImpact[];
  budgetPersonalExpenseSources: FixtureBudgetPersonalExpenseSource[];
  budgetPersonalRepaymentSources: FixtureBudgetPersonalRepaymentSource[];
  budgetGroupExpenseSources: FixtureBudgetGroupExpenseSource[];
  budgetGroupSettlementSources: FixtureBudgetGroupSettlementSource[];
  budgetGroupObligationClassifications: FixtureBudgetGroupObligationClassification[];
  recurringTemplates: FixtureBudgetRecurringTemplate[];
  recurringOccurrences: FixtureBudgetRecurringOccurrence[];
};

export const SCALE_ACTIVE_BUDGET_PERIOD_NAME = "September Budget";
export const SCALE_HEAVY_RECURRING_NAME = "Heavy Recurring";

const SCALE_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SCALE_BUDGET_CATEGORY_NAMES = [
  "Uncategorized", "Makanan", "Transportasi", "Belanja", "Hiburan", "Kesehatan",
  "Pendidikan", "Tagihan", "Tabungan", "Donasi", "Perjalanan", "Keluarga",
  "Kerja", "Lainnya", "Gadget Lama",
];

const SCALE_BUDGET_DESCRIPTIONS = [
  "Kopi kenangan", "Bensin motor", "Belanja pasar", "Makan siang", "Parkir mal",
  "Pulsa", "Laundry", "Ojek", "Jajan", "Buku", "Obat", "Iuran",
  "Servis motor", "Potong rambut", "Nonton", "Langganan", "Donasi",
  "Oleh-oleh", "Cetak foto", "Peralatan", "Kado", "Zakat", "Tabungan",
  "Gaji masuk", "Refund", "Bonus", "Cashback", "Penjualan preloved",
];

const SCALE_RECURRING_NAMES = [
  "Netflix", "Spotify", "Internet bulanan", "Kos bulanan", "Heavy Recurring",
  "Gym", "Iuran sampah", "Les bahasa", "Asuransi", "Donasi rutin",
  "Parkir bulanan", "Laundry langganan", "Air galon", "Token listrik", "Pulsa utama",
  "Hosting", "Domain", "VPN", "Cloud storage", "Top-up e-wallet",
  "Majalah", "Koran digital", "Kursus online", "Iuran RT", "Keamanan",
  "TV kabel", "Air mineral", "Gas", "Kebersihan", "Servis AC",
  "Vitamin", "Skincare", "Potong rambut", "Bensin langganan", "Tol langganan",
  "Parkir kantor", "Makan siang kantor", "Kopi kantor", "ATK", "Fotokopi",
  "Kurir", "Ojek kantor", "Rapat konsumsi", "Seragam", "Sepatu",
  "Tas", "Dompet", "Jam", "Kacamata", "Obat rutin",
  "Dokter gigi", "Check-up", "Suplemen", "Protein", "Susu",
  "Pampers", "Susu anak", "Sekolah", "Les anak", "Mainan",
  "Buku anak", "Pakaian", "Arisan", "Iuran masjid", "Sedekah",
  "Tabungan haji", "Dana darurat", "Investasi", "Emas", "Deposito",
];

function budgetPeriodRange(ordinal: number) {
  // Ordinal 1 = February 2025 through ordinal 20 = September 2026 (active).
  const base = ordinal;
  const year = 2025 + Math.floor(base / 12);
  const month = base % 12;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    startsOn: `${year}-${pad(month + 1)}-01`,
    endsOn: `${year}-${pad(month + 1)}-${pad(days)}`,
    name: ordinal === 20 ? SCALE_ACTIVE_BUDGET_PERIOD_NAME : `${SCALE_MONTH_NAMES[month]} ${year}`,
  };
}

function generateBudget(
  ownerUserId: string,
  fixedCreatedAt: Date,
  outings: FixtureOuting[],
  expenses: FixtureExpense[],
  repayments: FixtureRepayment[],
  groups: ScaleGroupFixture,
  seed: number,
): ScaleBudgetFixture {
  const fixture: ScaleBudgetFixture = {
    budgetPeriods: [], budgetCategories: [], budgetPeriodCategories: [],
    budgetTransactions: [], budgetImpacts: [],
    budgetPersonalExpenseSources: [], budgetPersonalRepaymentSources: [],
    budgetGroupExpenseSources: [], budgetGroupSettlementSources: [],
    budgetGroupObligationClassifications: [],
    recurringTemplates: [], recurringOccurrences: [],
  };
  const derived = buildBudgetPeriodsAndPlans(fixture, fixedCreatedAt);
  const ctx: BudgetBuildContext = {
    fixture,
    ownerUserId,
    next: randomUniform(seed ^ 0x61003),
    fixedCreatedAt,
    ...derived,
    state: { transaction: 0, impact: 0, occurrence: 0, classified: 0 },
    classifiedObligations: new Set<string>(),
  };
  buildManualBudgetTransactions(ctx);
  buildSpreadBudgetTransactions(ctx);

  // Linked Personal activity: full-amount flows with Uncategorized absorption
  // in-period and zero-impact links outside budget coverage.
  buildPersonalBudgetLinks(ctx, outings, expenses, repayments);
  buildGroupBudgetLinks(ctx, groups);
  buildRecurringTemplates(ctx);
  buildRecurringOccurrences(ctx);
  applyBudgetTopUps(ctx);
  return fixture;
}

export type FixtureChatThread = {
  id: string;
  organizationId: string | null;
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureChatMessage = {
  id: string;
  threadId: string;
  organizationId: string | null;
  groupId: string | null;
  senderUserId: string;
  senderParticipantId: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedByUserId: string | null;
};

export type FixtureChatThreadRead = {
  threadId: string;
  userId: string;
  lastReadMessageId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScaleChatFixture = {
  chatThreads: FixtureChatThread[];
  chatMessages: FixtureChatMessage[];
  chatThreadReads: FixtureChatThreadRead[];
};

export type FixtureNotification = {
  id: string;
  recipientUserId: string;
  type: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
  dedupeKey: string | null;
};

const SCALE_CHAT_BODIES = [
  "Halo semua, selamat pagi", "Siap, saya ikut", "Berapa patungan kali ini?",
  "Sudah saya transfer ya", "Tolong cek mutasi", "Kuitansi sudah saya foto",
  "Besok jadi jam berapa?", "Lokasi di mana?", "Saya bawa mobil, bisa nebeng 3 orang",
  "Oke, dicatat", "Terima kasih banyak", "Sama-sama", "Jangan lupa bawa KTP",
  "Cuaca bagus hari ini", "Sampai ketemu nanti", "Saya telat 10 menit",
  "Sudah sampai lokasi", "Parkir di basement ya", "Makan dulu yuk",
  "Split bill seperti biasa", "Saya talangin dulu", "Nanti diganti akhir bulan",
  "Ada yang punya kembalian?", "Qris saja biar gampang", "Noted, masuk kas",
  "Rapat minggu depan jam 9", "Bahan sudah saya share", "Tolong konfirmasi kehadiran",
  "Setuju dengan usulan kemarin", "Bisa, saya handle konsumsi", "Dokumentasi menyusul",
  "Terima kasih kerjasamanya", "Sampai jumpa lagi", "Hati-hati di jalan",
  "Info kosan baru sudah saya kirim", "Iuran bulan ini naik sedikit",
  "Jadwal piket sudah ditempel", "Acara jalan-jalan fix tanggal 20",
  "Bawa jaket, dingin", "Jangan lupa obat pribadi", "Tiket sudah dipesan",
  "Itinerary v3 sudah final", "Koper maksimal 20kg", "Kumpul di stasiun jam 6",
  "Siap berangkat", "Sudah boarding", "Mendarat dengan selamat",
];

function generateChat(
  ownerUserId: string,
  fixedCreatedAt: Date,
  secondaryUsers: FixtureSecondaryUser[],
  groups: ScaleGroupFixture,
  organizations: ScaleOrganizationFixture,
  seed: number,
): ScaleChatFixture {
  const next = randomUniform(seed ^ 0x61004);
  const fixture: ScaleChatFixture = { chatThreads: [], chatMessages: [], chatThreadReads: [] };
  let messageCounter = 0;
  const threadBase = Date.UTC(2026, 4, 1);

  const pushMessages = (
    threadId: string, organizationId: string | null, groupId: string | null,
    senders: { userId: string; participantId: string | null }[],
    count: number, stepMs: number, threadIndex: number,
  ) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const sender = senders[(index * 7 + threadIndex * 3) % senders.length]!;
      const at = new Date(threadBase + threadIndex * 86_400_000 + index * stepMs + integer(next, stepMs));
      const edited = index % 53 === 7;
      const deleted = index % 97 === 11;
      const body = threadIndex === 1 && index === 600
        ? "Long chat message " + "x".repeat(2482)
        : `${SCALE_CHAT_BODIES[(index * 11 + threadIndex * 5) % SCALE_CHAT_BODIES.length]}${index >= SCALE_CHAT_BODIES.length ? ` (${Math.floor(index / SCALE_CHAT_BODIES.length) + 1})` : ""}`;
      const id = fixtureId("chatMessage", messageCounter);
      messageCounter += 1;
      ids.push(id);
      fixture.chatMessages.push({
        id, threadId, organizationId, groupId,
        senderUserId: sender.userId, senderParticipantId: sender.participantId,
        body: body.slice(0, 4000), createdAt: at,
        editedAt: edited ? new Date(at.getTime() + 3_600_000) : null,
        deletedAt: deleted ? new Date(at.getTime() + 7_200_000) : null,
        deletedByUserId: deleted ? sender.userId : null,
      });
    }
    return ids;
  };

  groups.groups.forEach((group, groupIndex) => {
    const threadId = fixtureId("chatThread", groupIndex);
    fixture.chatThreads.push({
      id: threadId, organizationId: null, groupId: group.id,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    const memberSenders = groups.groupMemberships
      .filter((row) => row.groupId === group.id)
      .map((row) => ({ userId: row.userId, participantId: row.participantId }));
    if (memberSenders.length === 0) return;
    const count = groupIndex === 1 ? 1300 : groupIndex < 8 ? 24 + ((groupIndex * 7) % 40) : groupIndex === 7 ? 3 : 6 + ((groupIndex * 5) % 10);
    const ids = pushMessages(threadId, null, group.id, memberSenders, count, groupIndex === 1 ? 2_220_000 : 21_600_000, groupIndex);
    if (groupIndex % 2 === 0 && ids.length > 0) {
      const cursor = ids[Math.floor(ids.length * 0.7)]!;
      fixture.chatThreadReads.push({
        threadId, userId: ownerUserId, lastReadMessageId: cursor,
        createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
      });
    }
  });

  organizations.organizations.forEach((organization, orgIndex) => {
    const threadId = fixtureId("chatThread", 100 + orgIndex);
    fixture.chatThreads.push({
      id: threadId, organizationId: organization.id, groupId: null,
      createdAt: copyDate(fixedCreatedAt), updatedAt: copyDate(fixedCreatedAt),
    });
    const memberSenders = organizations.organizationMemberships
      .filter((row) => row.organizationId === organization.id)
      .map((row) => ({ userId: row.userId, participantId: null as string | null }));
    if (memberSenders.length === 0) return;
    const count = 20 + ((orgIndex * 11) % 24);
    pushMessages(threadId, organization.id, null, memberSenders, count, 28_800_000, 100 + orgIndex);
  });

  return fixture;
}

function generateNotifications(
  ownerUserId: string,
  fixedCreatedAt: Date,
  friends: FixtureFriend[],
  groups: ScaleGroupFixture,
  organizations: ScaleOrganizationFixture,
  seed: number,
): FixtureNotification[] {
  void fixedCreatedAt;
  const ctx: NotificationBuildContext = {
    notifications: [],
    ownerUserId,
    friends,
    groups,
    organizations,
    next: randomUniform(seed ^ 0x61005),
  };
  const reused = appendFinancialNotifications(ctx);
  appendInvitationNotifications(ctx);
  appendFillerNotifications(ctx, reused.ownerExpenses, reused.ownerConfirmedSettlements);
  return ctx.notifications;
}

type NotificationBuildContext = {
  notifications: FixtureNotification[];
  ownerUserId: string;
  friends: FixtureFriend[];
  groups: ScaleGroupFixture;
  organizations: ScaleOrganizationFixture;
  next: () => number;
};

function notificationDisplayName(ctx: NotificationBuildContext, userId: string | null, fallback: string) {
  if (!userId) return fallback;
  if (userId === ctx.ownerUserId) return "Scale owner";
  return `Member ${userId.slice(-3)}`;
}

function notificationParticipantName(ctx: NotificationBuildContext, groupId: string, participantId: string) {
  const participant = ctx.groups.groupParticipants.find((row) => row.groupId === groupId && row.id === participantId);
  if (!participant) return "Participant";
  if (participant.displayName) return participant.displayName;
  return notificationDisplayName(ctx, participant.userId, "Member");
}

function notificationGroupName(ctx: NotificationBuildContext, groupId: string) {
  return ctx.groups.groups.find((row) => row.id === groupId)?.name ?? "Group";
}

function pushNotification(
  ctx: NotificationBuildContext,
  type: string,
  metadata: Record<string, unknown>,
  ageDays: number,
  read: boolean,
  dedupe: string | null,
) {
  const at = new Date(Date.UTC(2026, 8, 9, 12) - ageDays * 86_400_000 - integer(ctx.next, 86_400_000));
  ctx.notifications.push({
    id: fixtureId("notification", ctx.notifications.length),
    recipientUserId: ctx.ownerUserId, type, metadata,
    createdAt: at, readAt: read ? new Date(at.getTime() + 86_400_000) : null,
    dedupeKey: dedupe,
  });
}

function appendFinancialNotifications(ctx: NotificationBuildContext) {
  const { groups, ownerUserId } = ctx;
  const ownerPayerPending = groups.groupExpenses.filter((expense) => {
    const payer = groups.groupParticipants.find((row) => row.id === expense.payerParticipantId);
    return expense.state === "pending" && payer?.userId === ownerUserId;
  });
  for (const [index, expense] of ownerPayerPending.slice(0, 12).entries()) {
    pushNotification(ctx, "group.expense.payer.claim", {
      expenseId: expense.id, groupId: expense.groupId,
      groupName: notificationGroupName(ctx, expense.groupId), description: expense.description,
    }, 1 + index, index % 4 === 3, `scale:payer-claim:${expense.id}`);
  }
  const ownerRecipientPending = groups.groupSettlements.filter((settlement) => {
    const recipient = groups.groupParticipants.find((row) => row.id === settlement.recipientParticipantId);
    return settlement.state === "pending" && recipient?.userId === ownerUserId;
  });
  for (const [index, settlement] of ownerRecipientPending.slice(0, 8).entries()) {
    pushNotification(ctx, "group.settlement.confirmation", {
      settlementId: settlement.id, groupId: settlement.groupId,
      groupName: notificationGroupName(ctx, settlement.groupId),
      senderParticipantId: settlement.senderParticipantId,
      senderDisplayName: notificationParticipantName(ctx, settlement.groupId, settlement.senderParticipantId),
    }, 2 + index, index % 3 === 2, `scale:settlement:${settlement.id}`);
  }
  const ownerOffsets = groups.groupOffsets.filter((offset) => {
    const initiator = groups.groupParticipants.find((row) => row.id === offset.initiatorParticipantId);
    const counterparty = groups.groupParticipants.find((row) => row.id === offset.counterpartyParticipantId);
    return offset.state === "pending" && (initiator?.userId === ownerUserId || counterparty?.userId === ownerUserId);
  });
  for (const [index, offset] of ownerOffsets.slice(0, 6).entries()) {
    pushNotification(ctx, "group.offset.confirmation", {
      offsetId: offset.id, groupId: offset.groupId,
      groupName: notificationGroupName(ctx, offset.groupId),
      initiatorParticipantId: offset.initiatorParticipantId,
      initiatorDisplayName: notificationParticipantName(ctx, offset.groupId, offset.initiatorParticipantId),
    }, 3 + index, index % 2 === 1, `scale:offset:${offset.id}`);
  }
  const ownerExpenses = groups.groupExpenses.filter((expense) => {
    const participants = groups.groupParticipants.filter((row) => row.groupId === expense.groupId);
    return participants.some((row) => row.userId === ownerUserId && (row.id === expense.creatorParticipantId || row.id === expense.payerParticipantId));
  });
  for (const [index, expense] of ownerExpenses.filter((row) => row.state === "confirmed").slice(0, 10).entries()) {
    pushNotification(ctx, "group.expense.payer.claim.outcome", {
      expenseId: expense.id, groupId: expense.groupId,
      description: expense.description, status: "confirmed",
    }, 10 + index * 2, true, `scale:claim-outcome:${expense.id}:confirmed`);
  }
  for (const [index, expense] of ownerExpenses.filter((row) => row.state === "rejected").slice(0, 4).entries()) {
    pushNotification(ctx, "group.expense.payer.claim.outcome", {
      expenseId: expense.id, groupId: expense.groupId,
      description: expense.description, status: "rejected",
    }, 12 + index * 3, true, `scale:claim-outcome:${expense.id}:rejected`);
  }
  const ownerConfirmedSettlements = groups.groupSettlements.filter((settlement) => {
    if (settlement.state !== "confirmed") return false;
    const sender = groups.groupParticipants.find((row) => row.id === settlement.senderParticipantId);
    const recipient = groups.groupParticipants.find((row) => row.id === settlement.recipientParticipantId);
    return sender?.userId === ownerUserId || recipient?.userId === ownerUserId;
  });
  for (const [index, settlement] of ownerConfirmedSettlements.slice(0, 8).entries()) {
    pushNotification(ctx, "group.settlement.outcome", {
      settlementId: settlement.id, groupId: settlement.groupId, status: "confirmed",
    }, 14 + index * 2, true, `scale:settlement-outcome:${settlement.id}`);
  }
  const ownerConfirmedOffsets = groups.groupOffsets.filter((offset) => {
    if (offset.state !== "confirmed") return false;
    const initiator = groups.groupParticipants.find((row) => row.id === offset.initiatorParticipantId);
    const counterparty = groups.groupParticipants.find((row) => row.id === offset.counterpartyParticipantId);
    return initiator?.userId === ownerUserId || counterparty?.userId === ownerUserId;
  });
  for (const [index, offset] of ownerConfirmedOffsets.slice(0, 4).entries()) {
    pushNotification(ctx, "group.offset.outcome", {
      offsetId: offset.id, groupId: offset.groupId, status: "confirmed",
    }, 16 + index * 3, true, `scale:offset-outcome:${offset.id}`);
  }
  return { ownerExpenses, ownerConfirmedSettlements };
}

function appendInvitationNotifications(ctx: NotificationBuildContext) {
  const { groups, organizations, friends, ownerUserId } = ctx;
  for (const [index, request] of groups.groupJoinRequests.filter((row) => row.targetUserId === ownerUserId).entries()) {
    const requester = groups.groupParticipants.find((row) => row.groupId === request.groupId && row.userId === request.requesterUserId);
    if (request.kind === "member_invitation") {
      pushNotification(ctx, "group.invitation", {
        requestId: request.id, groupId: request.groupId,
        groupName: notificationGroupName(ctx, request.groupId),
        requesterDisplayName: notificationDisplayName(ctx, request.requesterUserId, "Member"),
        requesterUsername: requester?.userId ? `scalem${requester.userId.slice(-3)}` : null,
        expiresAt: request.expiresAt.toISOString(),
      }, 1 + index, false, `scale:group-invite:${request.id}`);
    } else {
      pushNotification(ctx, "group.participant.link.request", {
        requestId: request.id, groupId: request.groupId,
        groupName: notificationGroupName(ctx, request.groupId),
        requesterDisplayName: notificationDisplayName(ctx, request.requesterUserId, "Member"),
        requesterUsername: requester?.userId ? `scalem${requester.userId.slice(-3)}` : null,
        participantDisplayName: request.participantDisplayNameSnapshot ?? "External",
        participantLabel: request.participantLabelSnapshot,
        expiresAt: request.expiresAt.toISOString(),
      }, 2 + index, false, `scale:participant-link:${request.id}`);
    }
  }
  const ownerOrgInvite = organizations.organizationInvitations.find((row) => row.targetUserId === ownerUserId)!;
  pushNotification(ctx, "organization.invitation", {
    invitationId: ownerOrgInvite.id, organizationId: ownerOrgInvite.organizationId,
    organizationName: organizations.organizations.find((row) => row.id === ownerOrgInvite.organizationId)?.name ?? "Organization",
    inviterDisplayName: notificationDisplayName(ctx, ownerOrgInvite.invitedByUserId, "Member"),
    role: ownerOrgInvite.role, expiresAt: ownerOrgInvite.expiresAt.toISOString(),
  }, 2, false, `scale:org-invite:${ownerOrgInvite.id}`);
  const declinedOrgInvite = organizations.organizationInvitations.find((row) => row.status === "declined")!;
  pushNotification(ctx, "organization.invitation.outcome", {
    invitationId: declinedOrgInvite.id, organizationId: declinedOrgInvite.organizationId, status: "declined",
  }, 20, true, `scale:org-outcome:${declinedOrgInvite.id}`);
  for (let index = 0; index < 8; index += 1) {
    pushNotification(ctx, "friend.link.request", {
      requestId: fixtureId("groupJoinRequest", 200 + index),
      friendId: friends[(index * 13) % friends.length]!.id,
      requesterDisplayName: `Member ${String(index + 1).padStart(3, "0")}`,
      requesterUsername: `scalem${String(index + 1).padStart(3, "0")}`,
      friendName: friends[(index * 13) % friends.length]!.name,
    }, 4 + index, index % 3 === 2, `scale:friend-link:${index}`);
  }
  for (let index = 0; index < 2; index += 1) {
    pushNotification(ctx, "friend.link.request.outcome", {
      requestId: fixtureId("groupJoinRequest", 300 + index),
      friendId: friends[(index * 29) % friends.length]!.id,
      status: index === 0 ? "accepted" : "declined",
    }, 30 + index * 5, true, `scale:friend-outcome:${index}`);
  }
  for (let index = 0; index < 4; index += 1) {
    pushNotification(ctx, "system.test", { message: `Scale fixture heartbeat ${index + 1}` }, 40 + index * 7, true, null);
  }
}

function appendFillerNotifications(
  ctx: NotificationBuildContext,
  ownerExpenses: FixtureGroupExpense[],
  ownerConfirmedSettlements: FixtureGroupSettlement[],
) {
  const { groups, ownerUserId } = ctx;
  const fillerSources = [
    ...ownerExpenses.filter((row) => row.state === "confirmed").slice(10, 60).map((expense) => ({
      type: "group.expense.payer.claim.outcome",
      metadata: { expenseId: expense.id, groupId: expense.groupId, description: expense.description, status: "confirmed" },
      dedupe: `scale:claim-outcome:${expense.id}:confirmed`,
    })),
    ...ownerConfirmedSettlements.slice(8, 60).map((settlement) => ({
      type: "group.settlement.outcome",
      metadata: { settlementId: settlement.id, groupId: settlement.groupId, status: "confirmed" },
      dedupe: `scale:settlement-outcome:${settlement.id}`,
    })),
    ...groups.groupJoinRequests.filter((row) => row.targetUserId !== ownerUserId && row.status !== "pending").map((request) => ({
      type: request.kind === "member_invitation" ? "group.invitation.outcome" : "group.participant.link.outcome",
      metadata: { requestId: request.id, groupId: request.groupId, status: request.status === "accepted" ? "accepted" : "declined" },
      dedupe: `scale:join-outcome:${request.id}`,
    })),
  ];
  let fillerIndex = 0;
  while (ctx.notifications.length < 260 && fillerIndex < fillerSources.length * 3) {
    const source = fillerSources[fillerIndex % fillerSources.length]!;
    pushNotification(ctx, source.type, source.metadata, 45 + (fillerIndex % 70), fillerIndex % 5 !== 0, `${source.dedupe}:${Math.floor(fillerIndex / fillerSources.length)}`);
    fillerIndex += 1;
  }
  let heartbeat = 0;
  while (ctx.notifications.length < 260) {
    pushNotification(ctx, "system.test", { message: `Scale archive note ${heartbeat + 1}` }, 60 + (heartbeat % 60), true, null);
    heartbeat += 1;
  }
}

export const SCALE_SCENARIO_ANCHORS = {
  groups: [...SCALE_GROUP_ANCHORS],
  organizations: [...SCALE_ORGANIZATION_ANCHORS],
  trips: ["Japan Trip 2026", "Jakarta Weekend"],
  budgetPeriod: SCALE_ACTIVE_BUDGET_PERIOD_NAME,
  heavyRecurring: SCALE_HEAVY_RECURRING_NAME,
} as const;
