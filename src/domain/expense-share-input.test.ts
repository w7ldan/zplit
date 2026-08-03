import { describe, expect, it } from "vitest";
import { validateExpenseShareInput } from "./expense-share-input";

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
});
