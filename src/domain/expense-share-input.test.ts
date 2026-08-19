import { describe, expect, it } from "vitest";
import { calculateChargeAmount, calculateShareBreakdown, formatPercentageBasisPoints, parsePercentageBasisPoints, validateExpenseShareCharges, validateExpenseShareInput } from "./expense-share-input";

const friendA = "11111111-1111-4111-8111-111111111111";
const friendB = "22222222-2222-4222-8222-222222222222";

describe("expense share input", () => {
  it("omits blank rows and normalizes assigned amounts", () => {
    expect(validateExpenseShareInput([
      { friendId: friendA.toUpperCase(), amountRupiah: "84.000" },
      { friendId: friendB, amountRupiah: "   " },
    ])).toEqual({
      ok: true,
      values: [
        { friendId: friendA.toUpperCase(), amountRupiah: "84.000" },
        { friendId: friendB, amountRupiah: "" },
      ],
      value: [{ friendId: friendA, amountOwed: 84000 }],
    });
  });

  it("returns friend-keyed errors for malformed IDs and amounts", () => {
    expect(validateExpenseShareInput([
      { friendId: "not-a-uuid", amountRupiah: "84,000" },
      { friendId: friendA, amountRupiah: "84.00" },
    ])).toMatchObject({
      ok: false,
      errors: {
        "not-a-uuid": "Select a valid friend.",
        [friendA]: "Enter whole rupiah, such as 84000 or 84.000.",
      },
    });
  });

  it("rejects duplicate friends and excessive individual amounts", () => {
    expect(validateExpenseShareInput([
      { friendId: friendA, amountRupiah: "1" },
      { friendId: friendA.toUpperCase(), amountRupiah: "2" },
    ])).toMatchObject({ ok: false, errors: { [friendA]: "Each friend can have only one share per expense." } });
    expect(validateExpenseShareInput([{ friendId: friendB, amountRupiah: "2147483648" }])).toMatchObject({
      ok: false,
      errors: { [friendB]: "Amount is too large." },
    });
  });

  it("rejects non-row input", () => {
    expect(validateExpenseShareInput(null)).toEqual({ ok: false, errors: { "row-0": "Share rows are invalid." }, values: [] });
  });

  it("parses exact percentages and rounds each charge half up", () => {
    expect(parsePercentageBasisPoints("10")).toBe(1000);
    expect(parsePercentageBasisPoints("7.5")).toBe(750);
    expect(parsePercentageBasisPoints("2.25")).toBe(225);
    expect(formatPercentageBasisPoints(750)).toBe("7.5");
    expect(calculateChargeAmount(101, 750)).toBe(8);
    expect(calculateChargeAmount(100, 225)).toBe(2);
  });

  it("calculates additive charges from the base amount", () => {
    const charges = [
      { name: "PB1", percentageBasisPoints: 1000, scope: "all" as const, friendIds: [] },
      { name: "Service", percentageBasisPoints: 500, scope: "selected" as const, friendIds: [friendA] },
    ];
    expect(calculateShareBreakdown(100_000, charges, friendA)).toMatchObject({ baseAmount: 100_000, finalAmount: 115_000 });
    expect(calculateShareBreakdown(100_000, charges, friendB)).toMatchObject({ baseAmount: 100_000, finalAmount: 110_000 });
  });

  it("rejects invalid charge names, rates, scopes, and empty targets", () => {
    const result = validateExpenseShareCharges([
      { name: "", percentage: "", scope: "selected", friendIds: [] },
    ], [friendA]);
    expect(result).toMatchObject({ ok: false, errors: { "charge-0": expect.any(String) } });
    expect(validateExpenseShareCharges([{ name: "Fee", percentage: "2.345", scope: "all", friendIds: [] }], [friendA])).toMatchObject({ ok: false });
    expect(validateExpenseShareCharges([{ name: "Fee", percentage: "2", scope: "selected", friendIds: [friendB] }], [friendA])).toMatchObject({ ok: false });
  });
});
