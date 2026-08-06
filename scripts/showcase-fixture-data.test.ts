import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SHOWCASE_FIXED_TIMESTAMP,
  SHOWCASE_IDS,
  SHOWCASE_OWNER_EMAIL,
  SHOWCASE_OWNER_NAME,
  SHOWCASE_RECEIPT_PATH,
  generateShowcaseFixture,
  showcaseTotals,
} from "./showcase-fixture-data";
import { readFileSync } from "node:fs";

describe("showcase fixture data", () => {
  it("is deterministic across all six states", () => {
    for (const state of [1, 2, 3, 4, 5, 6] as const) {
      const fixture = generateShowcaseFixture("owner", state);
      const repeat = generateShowcaseFixture("owner", state);
      expect({ ...fixture, receipts: fixture.receipts.map(({ content, ...row }) => ({ ...row, contentBytes: content.byteLength })) }).toEqual({ ...repeat, receipts: repeat.receipts.map(({ content, ...row }) => ({ ...row, contentBytes: content.byteLength })) });
      expect(fixture.receipts.map(({ sha256 }) => sha256)).toEqual(repeat.receipts.map(({ sha256 }) => sha256));
    }
    expect(generateShowcaseFixture("owner", 6).friends.map(({ id }) => id)).toEqual([SHOWCASE_IDS.friends.rani, SHOWCASE_IDS.friends.dimas]);
  });

  it("contains the requested state boundaries and financial totals", () => {
    expect(generateShowcaseFixture("owner", 1)).toMatchObject({ friends: [{ name: "Rani" }, { name: "Dimas" }], outings: [], expenses: [] });
    expect(generateShowcaseFixture("owner", 2).outings).toHaveLength(1);
    expect(generateShowcaseFixture("owner", 3)).toMatchObject({ expenses: [{ description: "Dinner", amount: 240_000 }, { description: "Taxi", amount: 120_000 }], expenseShares: [], receipts: [], repayments: [] });
    expect(generateShowcaseFixture("owner", 4)).toMatchObject({ expenseShares: [{ amountOwed: 84_000 }, { amountOwed: 42_500 }, { amountOwed: 42_500 }], repayments: [], receipts: [{ expenseId: SHOWCASE_IDS.expenses.dinner }] });
    expect(generateShowcaseFixture("owner", 5).repaymentAllocations.map(({ amount }) => amount)).toEqual([84_000, 42_500]);
    expect(showcaseTotals(5)).toEqual({ totalSpending: 360_000, assigned: 169_000, ownerPortion: 191_000, raniOutstanding: 0, dimasOutstanding: 42_500 });
    expect(showcaseTotals(4)).toEqual({ totalSpending: 360_000, assigned: 169_000, ownerPortion: 191_000, raniOutstanding: 126_500, dimasOutstanding: 42_500 });
  });

  it("validates the tracked PNG receipt metadata and fixed timestamps", () => {
    const content = readFileSync(SHOWCASE_RECEIPT_PATH);
    const receipt = generateShowcaseFixture("owner", 6).receipts[0]!;
    expect(content.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
    expect(receipt.mediaType).toBe("image/png");
    expect(receipt.byteSize).toBe(content.byteLength);
    expect(receipt.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(receipt.createdAt.toISOString()).toBe(SHOWCASE_FIXED_TIMESTAMP);
    expect(receipt.originalFilename).toBe("showcase-dinner-receipt.png");
    expect(SHOWCASE_OWNER_NAME).toBe("Zplit Showcase");
    expect(SHOWCASE_OWNER_EMAIL).toBe("showcase@zplit.local");
  });
});
