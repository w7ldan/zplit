import { describe, expect, it } from "vitest";
import { validateRepaymentAllocationInput } from "./repayment-allocation-input";

const shareA = "11111111-1111-4111-8111-111111111111";
const shareB = "22222222-2222-4222-8222-222222222222";

describe("repayment allocation input", () => {
  it("omits blanks and normalizes whole-rupiah amounts", () => {
    expect(validateRepaymentAllocationInput([
      { expenseShareId: shareA.toUpperCase(), amountRupiah: "84.000" },
      { expenseShareId: shareB, amountRupiah: "   " },
    ])).toEqual({
      ok: true,
      values: [
        { expenseShareId: shareA.toUpperCase(), amountRupiah: "84.000" },
        { expenseShareId: shareB, amountRupiah: "" },
      ],
      value: [{ expenseShareId: shareA, amount: 84000 }],
    });
  });

  it("returns share-keyed errors for malformed IDs and amounts", () => {
    expect(validateRepaymentAllocationInput([
      { expenseShareId: "not-a-uuid", amountRupiah: "84,000" },
      { expenseShareId: shareA, amountRupiah: "84.00" },
      { expenseShareId: shareB, amountRupiah: "0" },
    ])).toMatchObject({
      ok: false,
      errors: {
        "not-a-uuid": "Select a valid expense share.",
        [shareA]: "Enter whole rupiah, such as 84000 or 84.000.",
        [shareB]: "Amount must be greater than zero.",
      },
    });
  });

  it("rejects duplicate IDs and excessive amounts", () => {
    expect(validateRepaymentAllocationInput([
      { expenseShareId: shareA, amountRupiah: "1" },
      { expenseShareId: shareA.toUpperCase(), amountRupiah: "2" },
    ])).toMatchObject({ ok: false, errors: { [shareA]: "Each expense share can appear only once." } });
    expect(validateRepaymentAllocationInput([{ expenseShareId: shareB, amountRupiah: "2147483648" }])).toMatchObject({
      ok: false,
      errors: { [shareB]: "Amount is too large." },
    });
  });

  it("rejects non-row input", () => {
    expect(validateRepaymentAllocationInput(null)).toEqual({ ok: false, errors: { "row-0": "Allocation rows are invalid." }, values: [] });
  });
});
