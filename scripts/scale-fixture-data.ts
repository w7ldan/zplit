import { createHash } from "node:crypto";

export const SCALE_FIXTURE_SEED = 0x05ca1e;
export const SCALE_FIXTURE_DATABASE = "zplit_scale_test";
export const SCALE_FIXTURE_CONFIRMATION = "scale-test-only";
export const SCALE_FIXTURE_COUNTS = {
  friends: 100,
  activeFriends: 80,
  archivedFriends: 20,
  outings: 300,
  expenses: 2_000,
  expenseShares: 5_792,
  repayments: 1_000,
  repaymentAllocations: 429,
  receipts: 8,
} as const;

const createdAt = "2026-01-01T00:00:00.000Z";
const kindCodes = {
  friend: "001",
  outing: "002",
  expense: "003",
  share: "004",
  repayment: "005",
  receipt: "006",
} as const;

export type FixtureIdKind = keyof typeof kindCodes;

export type FixtureFriend = {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FixtureOuting = {
  id: string;
  userId: string;
  title: string;
  occurredAt: Date;
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
  outings: FixtureOuting[];
  expenses: FixtureExpense[];
  expenseShares: FixtureExpenseShare[];
  repayments: FixtureRepayment[];
  repaymentAllocations: FixtureRepaymentAllocation[];
  receipts: FixtureReceipt[];
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
  if (index === 0) return date("2023-01-31T23:59:59.999Z");
  if (index === 1) return date("2023-02-01T00:00:00.000Z");
  if (index === 2) return date("2023-03-01T00:00:00.000+14:00");
  const month = index % 36;
  return new Date(Date.UTC(
    2023 + Math.floor(month / 12),
    month % 12,
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

export function generateScaleFixture(userId = "scale-fixture-user", seed = SCALE_FIXTURE_SEED): ScaleFixtureData {
  if (!userId.trim()) throw new Error("userId is required");
  if (!Number.isInteger(seed)) throw new Error("seed must be an integer");
  const next = random(seed);
  const fixedCreatedAt = date(createdAt);
  const friends: FixtureFriend[] = [];
  const outings: FixtureOuting[] = [];
  const expenses: FixtureExpense[] = [];
  const expenseShares: FixtureExpenseShare[] = [];
  const repayments: FixtureRepayment[] = [];
  const repaymentAllocations: FixtureRepaymentAllocation[] = [];

  for (let index = 0; index < SCALE_FIXTURE_COUNTS.friends; index += 1) {
    friends.push({
      id: fixtureId("friend", index),
      userId,
      name: index === 0 ? `Long friend ${"x".repeat(108)}` : `Scale friend ${String(index + 1).padStart(3, "0")}`,
      phoneNumber: index % 3 === 0 ? `+62812${String(index).padStart(6, "0")}` : null,
      notes: index % 4 === 0 ? "Fixture contact with notes for list and detail rendering." : null,
      archivedAt: index < SCALE_FIXTURE_COUNTS.activeFriends ? null : new Date(Date.UTC(2025, index % 12, 15, 9)),
      createdAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    });
  }

  for (let index = 0; index < SCALE_FIXTURE_COUNTS.outings; index += 1) {
    const occurredAt = outingTimestamp(index, next);
    outings.push({
      id: fixtureId("outing", index),
      userId,
      title: index === 0 ? `Long outing ${"y".repeat(148)}` : `Scale outing ${String(index + 1).padStart(3, "0")}`,
      occurredAt,
      notes: index % 6 === 0 ? "Historical fixture outing for list, filtering, and timeline rendering." : null,
      createdAt: copyDate(fixedCreatedAt),
      updatedAt: copyDate(fixedCreatedAt),
    });
  }

  for (let index = 0; index < SCALE_FIXTURE_COUNTS.expenses; index += 1) {
    const amount = index < 5 ? [12_000, 18_000, 22_000, 24_000, 26_000][index]! : 10_000 + integer(next, 90_001);
    expenses.push({
      id: fixtureId("expense", index),
      userId,
      outingId: outings[index % outings.length]!.id,
      description: index === 0 ? `Long expense ${"z".repeat(187)}` : `Scale expense ${String(index + 1).padStart(4, "0")}`,
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
      const amountOwed = specialAmounts?.[offset] ?? (offset === friendIndexes.length - 1
        ? remaining
        : Math.max(1, Math.floor(totalOwed * weights[offset]! / weightTotal)));
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
    repayments.push({
      id: repaymentId,
      userId,
      friendId: friends[friendIndex]!.id,
      amount,
      paidAt: repaymentTimestamp(index, next),
      paymentMethod: ["cash", "bank transfer", "mobile transfer", "card"][index % 4]!,
      notes: index < 5 ? "Deterministic scale fixture scenario" : null,
      createdAt: copyDate(fixedCreatedAt),
    });
    if (allocation) {
      repaymentAllocations.push({
        userId,
        repaymentId,
        expenseShareId: allocation.share.id,
        amount: allocation.amount,
        createdAt: copyDate(fixedCreatedAt),
      });
      remainingByShare.set(allocation.share.id, remainingByShare.get(allocation.share.id)! - allocation.amount);
      reservedShareIds.add(allocation.share.id);
    }
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
    repayments.push({
      id: repaymentId,
      userId,
      friendId: friends[friendIndex]!.id,
      amount,
      paidAt: repaymentTimestamp(index, next),
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
      repaymentAllocations.push({
        userId,
        repaymentId,
        expenseShareId: share.id,
        amount: allocationAmount,
        createdAt: copyDate(fixedCreatedAt),
      });
      remainingByShare.set(share.id, remainingShare - allocationAmount);
      budget -= allocationAmount;
    }
  }

  const receiptExpenseIndexes = [0, 1, 2, 3, 4, 120, 1_200, 1_999];
  const receipts = receiptExpenseIndexes.map((expenseIndex, index) => {
    const content = receiptContent();
    return {
      id: fixtureId("receipt", index),
      userId,
      expenseId: expenses[expenseIndex]!.id,
      originalFilename: `scale-receipt-${String(index + 1).padStart(2, "0")}.png`,
      mediaType: "image/png" as const,
      byteSize: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
      createdAt: copyDate(fixedCreatedAt),
    } satisfies FixtureReceipt;
  });

  return {
    seed,
    userId,
    friends,
    outings,
    expenses,
    expenseShares,
    repayments,
    repaymentAllocations,
    receipts,
  };
}
